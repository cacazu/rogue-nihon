/* Entry/lifetime and read-only inspection for the unchanged Rogue rule loop. */
#include <curses.h>
#include "rogue.h"
#include "core.h"
#include "../contract/rogue_abi.h"
#include <setjmp.h>
#include <stdarg.h>
#include <stdint.h>
#include <string.h>

_Static_assert(sizeof(int)==sizeof(uint32_t), "Rogue compatibility requires 32-bit int");

#ifdef RG_TEST_FIXTURES
/* Test builds alone provide a deterministic original-rule setup. */
void rg_test_apply_fixture(void);
#endif

static jmp_buf core_exit_scope;
static int core_active, core_started, final_code, pending_input, was_restored;
static uint32_t completed_turns;
static const char *final_message="ended";
static const char *startup_name="Player";

uint32_t rg_random_next(void) {
    uint32_t next_seed=(uint32_t)seed*UINT32_C(11109)+UINT32_C(13849);
    /* Store identical bit pattern without signed overflow or narrowing rules. */
    memcpy(&seed,&next_seed,sizeof(seed));
    return (next_seed>>16)&UINT32_C(0xffff);
}
void rg_core_tick_complete(void) {completed_turns++;}
uint32_t rg_core_turn(void) {return completed_turns;}
void rg_core_set_turn(uint32_t n) {completed_turns=n;}
void rg_core_pending(int n) {pending_input=n;}
int rg_core_was_restored(void) {return was_restored;}
const char *rg_core_player_name(void) {return startup_name;}
void rg_core_set_outcome(int code,const char *message) {final_code=code;final_message=message?message:"ended";}
void rg_core_exit(int code) {
    if(code<0 || code>0) final_code=code;
    pending_input=0;
    rg_knowledge_present();
    rg_host_outcome(final_code,final_message);
    if(core_active) longjmp(core_exit_scope,1);
    /* No process exit is allowed. Entry requires a fresh module per game. */
}
void rg_core_abort(void) {rg_core_set_outcome(-2,"invalid game state");rg_core_exit(-2);}

int32_t rg_core_start(uint32_t initial_seed,const char *name) {
    const uint8_t *restore_bytes=NULL;
    uint32_t restore_length=0;
    int restore_requested;
    if(core_started) return -3;
    core_started=1;core_active=1;
    final_code=0;final_message="ended";completed_turns=0;
    startup_name=(name && *name)?name:"Player";
    if(setjmp(core_exit_scope)) {core_active=0;return final_code;}
    memcpy(&seed,&initial_seed,sizeof(seed));
    memcpy(&dnum,&initial_seed,sizeof(dnum));
    strncpy(whoami,startup_name,MAXSTR-1);whoami[MAXSTR-1]=0;
    home[0]=0;
    strcpy(file_name,"rogue.save");
    md_init();
    open_score();
    init_check();
    if(!initscr()) {rg_core_set_outcome(-2,"knowledge allocation failed");rg_core_exit(-2);}
    init_probs();
    init_player();
    init_names();
    init_colors();
    init_stones();
    init_materials();
    setup();
    hw=newwin(LINES,COLS,0,0);
    if(!hw) {rg_core_set_outcome(-2,"scratch allocation failed");rg_core_exit(-2);}
    restore_requested=rg_host_restore_data(&restore_bytes,&restore_length);
    if(restore_requested>0) {
        if(rg_core_load_bytes(restore_bytes,restore_length)!=0) {
            rg_core_set_outcome(-4,"invalid restore checkpoint");rg_core_exit(-4);
        }
        was_restored=1;
        rg_knowledge_present();
    } else {
        if(restore_requested<0) {rg_core_set_outcome(-4,"restore unavailable");rg_core_exit(-4);}
        new_level();
        start_daemon(runners,0,AFTER);
        start_daemon(doctor,0,AFTER);
        fuse(swander,0,WANDERTIME,AFTER);
        start_daemon(stomach,0,AFTER);
#ifdef RG_TEST_FIXTURES
        rg_test_apply_fixture();
#endif
    }
    playit();
    rg_core_exit(0);
    return final_code;
}

void rg_command_state_get(uint32_t *out);
void rg_command_state_set(const uint32_t *in);
void rg_direction_state_get(uint32_t *out);
void rg_direction_state_set(const uint32_t *in);
void rg_status_state_get(uint32_t *out);
void rg_status_state_set(const uint32_t *in);
void rg_menu_state_get(uint32_t *out);
void rg_menu_state_set(const uint32_t *in);
uint32_t rg_core_runtime_export(uint32_t *out,uint32_t capacity) {
    if(!out || capacity<17) return 17;
    out[0]=completed_turns;
    rg_command_state_get(out+1);rg_direction_state_get(out+4);
    rg_status_state_get(out+6);rg_menu_state_get(out+14);
    return 17;
}
int rg_core_runtime_validate(const uint32_t *in,uint32_t words) {
    int32_t dx,dy,width;
    if(!in || words!=17 || in[1]>255 || in[2]>255 || in[3]>1) return -1;
    dx=(int32_t)in[4];dy=(int32_t)in[5];width=(int32_t)in[16];
    if(dx<-1 || dx>1 || dy<-1 || dy>1 || in[6]>10 || in[7]>3 || in[15]>1 || in[14]!=0 || width<-1 || width>4096) return -1;
    return 0;
}
int rg_core_runtime_import(const uint32_t *in,uint32_t words) {
    if(rg_core_runtime_validate(in,words)!=0) return -1;
    completed_turns=in[0];rg_command_state_set(in+1);rg_direction_state_set(in+4);
    rg_status_state_set(in+6);rg_menu_state_set(in+14);
    return 0;
}

static uint32_t hbyte(uint32_t h,uint32_t n) {return (h^(n&255u))*UINT32_C(16777619);}
static uint32_t hu32(uint32_t h,uint32_t n) {int i;for(i=0;i<4;i++){h=hbyte(h,n);n>>=8;}return h;}
static uint32_t htext(uint32_t h,const char *s) {
    if(!s) return hu32(h,0);
    while(*s) h=hbyte(h,(unsigned char)*s++);
    return hbyte(h,0);
}
static uint32_t hcoord(uint32_t h,const coord *p) {return hu32(hu32(h,(uint32_t)p->x),(uint32_t)p->y);}
static uint32_t hstats(uint32_t h,const struct stats *s) {
    h=hu32(h,s->s_str);h=hu32(h,s->s_exp);h=hu32(h,s->s_lvl);h=hu32(h,s->s_arm);
    h=hu32(h,s->s_hpt);h=hu32(h,s->s_maxhp);return htext(h,s->s_dmg);
}
static uint32_t hobject(uint32_t h,const THING *o) {
    h=hu32(h,o->o_type);h=hcoord(h,&o->o_pos);h=hu32(h,o->o_launch);h=hu32(h,(unsigned char)o->o_packch);
    h=htext(h,o->o_damage);h=htext(h,o->o_hurldmg);h=hu32(h,o->o_count);h=hu32(h,o->o_which);
    h=hu32(h,o->o_hplus);h=hu32(h,o->o_dplus);h=hu32(h,o->o_arm);h=hu32(h,o->o_flags);h=hu32(h,o->o_group);
    h=htext(h,o->o_label);return htext(h,o->o_text);
}
static uint32_t hobjects(uint32_t h,const THING *o) {for(;o;o=next(o)) h=hobject(h,o);return hu32(h,UINT32_C(0xffffffff));}
static uint32_t room_id(const struct room *p) {
    int i;
    if(!p) return UINT32_C(0xffffffff);
    for(i=0;i<MAXROOMS;i++) if(p==&rooms[i]) return (uint32_t)i;
    for(i=0;i<MAXPASS;i++) if(p==&passages[i]) return MAXROOMS+(uint32_t)i;
    return UINT32_C(0xfffffffe);
}
static uint32_t destination_hash(const coord *p) {
    int i;const THING *o;
    if(!p)return 0;
    if(p==&hero)return 1;
    for(i=0;i<MAXROOMS;i++) if(p==&rooms[i].r_gold)return 2+(uint32_t)i;
    for(i=0,o=lvl_obj;o;i++,o=next(o)) if(p==&o->o_pos)return 32+(uint32_t)i;
    /* Never dereference an unrecognized (possibly stale) destination pointer. */
    return UINT32_C(0xfffffffe);
}
static uint32_t hrooms(uint32_t h,const struct room *r,int count) {
    int i,j;
    for(i=0;i<count;i++,r++) {
        h=hcoord(h,&r->r_pos);h=hcoord(h,&r->r_max);h=hcoord(h,&r->r_gold);h=hu32(h,r->r_goldval);
        h=hu32(h,(uint16_t)r->r_flags);h=hu32(h,r->r_nexits);
        for(j=0;j<r->r_nexits && j<12;j++)h=hcoord(h,&r->r_exit[j]);
    }
    return h;
}
static uint32_t effect_id(void (*p)()) {
    void (*functions[])()={runners,doctor,stomach,swander,rollwand,unconfuse,unsee,sight,nohaste,come_down,visuals,land,(void(*)())turn_see};
    uint32_t i;
    if(!p)return 0;
    for(i=0;i<sizeof(functions)/sizeof(functions[0]);i++) if(p==functions[i])return i+1;
    return UINT32_C(0xffffffff);
}
uint32_t rg_core_inspect(uint32_t *out,uint32_t capacity) {
    uint32_t h=UINT32_C(2166136261),e=h,k=h,f=h;
    const uint16_t *known=rg_knowledge_cells();
    THING *t;int i;
    if(!out || capacity<RG_SNAPSHOT_WORDS) return RG_SNAPSHOT_WORDS;
    for(i=0;i<MAXCOLS*MAXLINES;i++) {
        h=hbyte(h,(unsigned char)places[i].p_ch);h=hbyte(h,(unsigned char)places[i].p_flags);
        h=hbyte(h,places[i].p_monst?(unsigned char)places[i].p_monst->t_type:0);
    }
    h=hrooms(h,rooms,MAXROOMS);h=hrooms(h,passages,MAXPASS);
    h=hu32(h,max_level);h=hcoord(h,&stairs);h=hu32(h,ntraps);
    e=hstats(e,&pstats);e=hu32(e,room_id(proom));e=hobjects(e,pack);e=hobjects(e,lvl_obj);
    for(t=mlist;t;t=next(t)) {
        e=hcoord(e,&t->t_pos);e=hu32(e,t->t_turn);e=hbyte(e,t->t_type);e=hbyte(e,t->t_disguise);
        e=hbyte(e,t->t_oldch);e=hu32(e,(uint16_t)t->t_flags);e=hstats(e,&t->t_stats);
        e=hu32(e,room_id(t->t_room));e=hu32(e,destination_hash(t->t_dest));e=hobjects(e,t->t_pack);
    }
    if(known)for(i=0;i<NUMLINES*NUMCOLS;i++) k=hu32(k,known[i]);
    for(i=0;i<MAXDAEMONS;i++) {f=hu32(f,d_list[i].d_type);f=hu32(f,effect_id(d_list[i].d_func));f=hu32(f,d_list[i].d_arg);f=hu32(f,d_list[i].d_time);}
    f=hu32(f,no_command);f=hu32(f,no_move);f=hu32(f,quiet);f=hu32(f,hungry_state);f=hu32(f,between);
    out[0]=RG_ABI_VERSION;out[1]=(uint32_t)seed;out[2]=level;out[3]=hero.x;out[4]=hero.y;
    out[5]=pstats.s_hpt;out[6]=max_hp;out[7]=purse;out[8]=food_left;out[9]=pstats.s_str;
    out[10]=cur_armor?cur_armor->o_arm:pstats.s_arm;out[11]=pstats.s_exp;out[12]=pstats.s_lvl;
    out[13]=completed_turns;out[14]=h;out[15]=e;out[16]=k;out[17]=f;
    out[18]=(uint32_t)(uint16_t)player.t_flags | ((uint32_t)running<<16) | ((uint32_t)after<<17) | ((uint32_t)amulet<<18);
    out[19]=(uint32_t)pending_input;
    return RG_SNAPSHOT_WORDS;
}

/* Console output is a legacy view, not stdout or a terminal. */
int rg_console_printf(const char *format,...) {
    char buffer[4096];int n;va_list args;
    va_start(args,format);n=vsnprintf(buffer,sizeof(buffer),format,args);va_end(args);
    if(n<0 || n>=(int)sizeof(buffer)) return -1;
    if(stdscr) {waddstr(stdscr,buffer);wrefresh(stdscr);}
    return n;
}
int rg_console_putchar(int ch) {if(stdscr){waddch(stdscr,(chtype)ch);wrefresh(stdscr);}return ch;}
int rg_console_getchar(void) {return getch();}
char *rg_console_fgets(char *buffer,int size,FILE *ignored) {
    int n=0,ch;(void)ignored;
    if(!buffer || size<1)return NULL;
    while(n<size-1) {ch=getch();if(ch<0){if(!n)return NULL;break;}buffer[n++]=(char)ch;if(ch=='\n'||ch=='\r')break;}
    buffer[n]=0;return buffer;
}
