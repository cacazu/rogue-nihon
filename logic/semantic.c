/* Source-derived entity descriptors. Original English, rules and RNG remain
 * authoritative. This module observes only values already chosen by the game.
 * The original Rogue license is retained in LICENSE.TXT. */
#include <curses.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include "rogue.h"
#include "semantic.h"

static char actor_terrain(THING *actor)
{
    char ch;
    if (actor == &player) return floor_at();
    /* Detection alone must not reveal a monster's unobserved surroundings. */
    if (!see_monst(actor)) return actor->t_oldch;
    ch = chat(actor->t_pos.y, actor->t_pos.x);
    if (ch == FLOOR && (actor->t_room->r_flags & ISDARK) && !see_floor)
        ch = ' ';
    return ch;
}

void rg_semantic_map_terrain(const uint8_t *cells,uint32_t rows,uint32_t columns)
{
    uint8_t terrain[MAXLINES * MAXCOLS];
    THING *actor;
    uint32_t length;
    int x,y;
    if (!cells || rows < 2 || !columns || rows > MAXLINES || columns > MAXCOLS) return;
    length = rows * columns;
    memset(terrain,255,length);
    /* Player and enemies share observation, conversion and compositing. Each
     * refresh replaces the observations, so movement/levels cannot leave tags. */
    for (actor = &player; actor; actor = actor == &player ? mlist : next(actor)) {
        x = actor->t_pos.x; y = actor->t_pos.y;
        if (x < 0 || (uint32_t)x >= columns || y <= 0 || (uint32_t)y >= rows - 1)
            continue;
        if (actor == &player) {
            if (cells[y * columns + x] != PLAYER) continue;
        } else if (!cells[y * columns + x] || !strchr("ABCDEFGHIJKLMNOPQRSTUVWXYZ*!?:)]/=,",cells[y * columns + x]))
            continue;
        terrain[y * columns + x] = (uint8_t)actor_terrain(actor);
    }
    rg_host_map_terrain(terrain,rows,columns);
}

#define RG_SEMANTIC_SLOTS 64
#define RG_SEMANTIC_TEXT 2048
#define RG_SEMANTIC_JSON 8192

struct semantic_entry {
    const char *pointer;
    char english[RG_SEMANTIC_TEXT];
    char json[RG_SEMANTIC_JSON];
};
static struct semantic_entry entries[RG_SEMANTIC_SLOTS];
static unsigned next_entry;

struct writer {char *data; size_t capacity, length; int valid;};
static void init(struct writer *out, char *data, size_t capacity)
{
    out->data=data; out->capacity=capacity; out->length=0; out->valid=capacity>0;
    if(capacity) data[0]=0;
}
static void append_raw(struct writer *out, const char *value)
{
    size_t length;
    if(!out->valid) return;
    length=strlen(value);
    if(length>=out->capacity-out->length) {out->valid=0;return;}
    memcpy(out->data+out->length,value,length+1); out->length+=length;
}
static void formatted(struct writer *out, const char *format,...)
{
    int count; va_list args;
    if(!out->valid) return;
    va_start(args,format);
    count=vsnprintf(out->data+out->length,out->capacity-out->length,format,args);
    va_end(args);
    if(count<0 || (size_t)count>=out->capacity-out->length) {out->valid=0;return;}
    out->length+=(size_t)count;
}
static void string(struct writer *out, const char *value)
{
    const unsigned char *p=(const unsigned char*)(value?value:"");
    char escaped[7];
    append_raw(out,"\"");
    for(;*p;p++) {
        if(*p=='"') append_raw(out,"\\\"");
        else if(*p=='\\') append_raw(out,"\\\\");
        else if(*p<32) {snprintf(escaped,sizeof escaped,"\\u%04x",*p);append_raw(out,escaped);}
        else {escaped[0]=(char)*p;escaped[1]=0;append_raw(out,escaped);}
    }
    append_raw(out,"\"");
}
static const char *boolean(int value) {return value?"true":"false";}
static void field_string(struct writer *out,const char *key,const char *value)
{
    append_raw(out,","); string(out,key); append_raw(out,":"); string(out,value);
}
static void remember(const char *text, const char *json)
{
    unsigned i,slot=RG_SEMANTIC_SLOTS;
    if(!text || !json || strlen(text)>=RG_SEMANTIC_TEXT || strlen(json)>=RG_SEMANTIC_JSON) return;
    for(i=0;i<RG_SEMANTIC_SLOTS;i++) if(entries[i].pointer==text) {slot=i;break;}
    if(slot==RG_SEMANTIC_SLOTS) {slot=next_entry++%RG_SEMANTIC_SLOTS;}
    entries[slot].pointer=text;
    strcpy(entries[slot].english,text);
    strcpy(entries[slot].json,json);
}
void rg_semantic_register_term(const char *text,const char *id)
{
    char json[RG_SEMANTIC_JSON];struct writer out;
    if(!text || !id)return;
    init(&out,json,sizeof json);append_raw(&out,"{\"type\":\"term\",\"id\":");string(&out,id);append_raw(&out,"}");
    if(out.valid)remember(text,json);
}
void rg_semantic_register_message(const char *text,const char *id,const char *args_json)
{
    char json[RG_SEMANTIC_JSON];struct writer out;
    if(!text || !id)return;
    init(&out,json,sizeof json);append_raw(&out,"{\"type\":\"message\",\"id\":");string(&out,id);
    append_raw(&out,",\"args\":");append_raw(&out,args_json?args_json:"[]");append_raw(&out,"}");
    if(out.valid)remember(text,json);
}
static const char *category_name(int category)
{
    switch(category) {
    case POTION:return "potion";case SCROLL:return "scroll";case RING:return "ring";
    case STICK:return "stick";case WEAPON:return "weapon";case ARMOR:return "armor";
    case FOOD:return "food";case GOLD:return "gold";case AMULET:return "amulet";
    default:return NULL;
    }
}
static int appearance_index(const char *value,char **table,int count)
{
    int i;
    if(!value) return -1;
    for(i=0;i<count;i++) if(value==table[i] || (table[i] && strcmp(value,table[i])==0)) return i;
    return -1;
}
static int stone_index(const char *value)
{
    int i;
    if(!value) return -1;
    for(i=0;i<cNSTONES;i++) if(value==stones[i].st_name || strcmp(value,stones[i].st_name)==0) return i;
    return -1;
}
static void appearance(struct writer *out,const char *kind,int index,const char *text)
{
    append_raw(out,"{\"kind\":"); string(out,kind);
    if(index>=0) formatted(out,",\"id\":%d,\"index\":%d",index,index);
    field_string(out,"text",text); append_raw(out,"}");
}
static void appearance_argument(struct writer *out,const char *kind,int index,const char *text)
{
    append_raw(out,"{\"type\":\"appearance\",\"kind\":");string(out,kind);
    if(index>=0)formatted(out,",\"id\":%d,\"index\":%d",index,index);
    field_string(out,"text",text);append_raw(out,"}");
}

void rg_semantic_item(const char *text,const THING *object,int drop)
{
    char json[RG_SEMANTIC_JSON]; struct writer out;
    const struct obj_info *info=NULL;
    const char *category,*equipment="none",*appearance_kind=NULL,*appearance_text=NULL;
    int which,known=1,identified,show_bonus=0,show_charges=0,show_weapon=0,show_armor=0,index=-1;
    if(!object || !(category=category_name(object->o_type))) return;
    which=object->o_which;
    switch(object->o_type) {
    case POTION: if(which<0||which>=MAXPOTIONS)return;info=&pot_info[which];
        appearance_kind="color";appearance_text=p_colors[which];index=appearance_index(appearance_text,rainbow,cNCOLORS);break;
    case SCROLL: if(which<0||which>=MAXSCROLLS)return;info=&scr_info[which];
        appearance_kind="scroll_title";appearance_text=s_names[which];break;
    case RING: if(which<0||which>=MAXRINGS)return;info=&ring_info[which];
        appearance_kind="stone";appearance_text=r_stones[which];index=stone_index(appearance_text);break;
    case STICK: if(which<0||which>=MAXSTICKS)return;info=&ws_info[which];
        appearance_text=ws_made[which];index=appearance_index(appearance_text,wood,cNWOOD);
        if(index>=0) appearance_kind="wood";
        else {appearance_kind="metal";index=appearance_index(appearance_text,metal,cNMETAL);}break;
    case WEAPON:if(which<0||which>=MAXWEAPONS)return;break;
    case ARMOR:if(which<0||which>=MAXARMORS)return;break;
    default:break;
    }
    if(info) known=info->oi_know;
    identified=(object->o_flags&ISKNOW)!=0;
    show_weapon=object->o_type==WEAPON && identified;
    show_armor=object->o_type==ARMOR && identified;
    if(info && (known || info->oi_guess) && identified) {
        show_charges=object->o_type==STICK;
        show_bonus=object->o_type==RING && (which==R_PROTECT || which==R_ADDSTR || which==R_ADDHIT || which==R_ADDDAM);
    }
    if(inv_describe) {
        if(object==cur_armor) equipment="armor";
        if(object==cur_weapon) equipment="weapon";
        if(object==cur_ring[LEFT]) equipment="left_ring";
        else if(object==cur_ring[RIGHT]) equipment="right_ring";
    }
    init(&out,json,sizeof json);append_raw(&out,"{\"type\":\"item\",\"category\":");string(&out,category);
    formatted(&out,",\"category_code\":%d,\"count\":%d,\"known\":%s,\"type_known\":%s,\"identified\":%s,\"flags\":%u,\"which\":",
        object->o_type,object->o_count,boolean(known),boolean(known),boolean(identified),(unsigned)(object->o_flags&ISKNOW));
    if(known) formatted(&out,"%d",which);else append_raw(&out,"null");
    formatted(&out,",\"describe\":%s,\"drop\":%s,\"brief\":false,\"terse\":%s",boolean(inv_describe),boolean(drop),boolean(terse));
    field_string(&out,"equipped",equipment);
    formatted(&out,",\"visible_fields\":{\"hplus\":%s,\"dplus\":%s,\"ac\":%s,\"charges\":%s,\"ring_bonus\":%s}",
        boolean(show_weapon),boolean(show_weapon),boolean(show_armor),boolean(show_charges),boolean(show_bonus));
    if(show_weapon) formatted(&out,",\"hplus\":%d,\"dplus\":%d",object->o_hplus,object->o_dplus);
    if(show_armor) formatted(&out,",\"ac\":%d,\"protection\":%d,\"enchantment\":%d",object->o_arm,10-object->o_arm,a_class[which]-object->o_arm);
    if(show_charges) formatted(&out,",\"charges\":%d",object->o_charges);
    if(show_bonus) formatted(&out,",\"bonus\":%d",object->o_arm);
    if(object->o_type==GOLD) formatted(&out,",\"gold\":%d",object->o_goldval);
    if((object->o_type==WEAPON || object->o_type==ARMOR) && object->o_label) field_string(&out,"label",object->o_label);
    if(info && !known && info->oi_guess) field_string(&out,"called",info->oi_guess);
    if(object->o_type==STICK) field_string(&out,"subtype",ws_type[which]);
    if(object->o_type==FOOD && which==1) field_string(&out,"fruit",fruit);
    if(appearance_kind) {append_raw(&out,",\"appearance\":");appearance(&out,appearance_kind,index,appearance_text);}
    append_raw(&out,"}");if(out.valid) remember(text,json);
}

void rg_semantic_monster(const char *text,int index,const char *display,int article,int upper,int hallucinated)
{
    char json[512];struct writer out;
    init(&out,json,sizeof json);append_raw(&out,"{\"type\":\"monster\",\"display\":");string(&out,display);
    if(index>=0 && index<26) formatted(&out,",\"index\":%d",index);
    field_string(&out,"article",article?"definite":"none");
    formatted(&out,",\"upper\":%s,\"hallucinated\":%s,\"role\":\"name\"}",boolean(upper),boolean(hallucinated));
    if(out.valid) remember(text,json);
}
void rg_semantic_combat_verb(const char *text,int hit,int index)
{
    char json[160];
    if(index<0 || index>=8) return;
    snprintf(json,sizeof json,"{\"type\":\"combat_verb\",\"hit\":%s,\"index\":%d,\"event\":\"%s\",\"variant\":%d}",boolean(hit),index,hit?"hit":"miss",index);
    remember(text,json);
}
void rg_semantic_category(const char *text,int category)
{
    char json[160];const char *name=category_name(category);
    if(!name)return;
    snprintf(json,sizeof json,"{\"type\":\"item_category\",\"category\":\"%s\",\"category_code\":%d}",name,category);
    remember(text,json);
}
void rg_semantic_death(const char *text,int code,int article)
{
    char json[256];struct writer out;
    init(&out,json,sizeof json);formatted(&out,"{\"type\":\"death\",\"code\":%d,\"article\":%s",code,boolean(article));
    if(code>='A' && code<='Z') formatted(&out,",\"index\":%d",code-'A');
    append_raw(&out,"}");if(out.valid) remember(text,json);
}

static int table_name(const char *text,struct obj_info *table,int count,int category,struct writer *out)
{
    int i;const char *name=category_name(category);
    for(i=0;i<count;i++) if(text==table[i].oi_name) {
        formatted(out,"{\"type\":\"item_name\",\"category\":\"%s\",\"category_code\":%d,\"which\":%d,\"form\":\"%s\"}",
            name,category,i,(category==WEAPON || category==ARMOR)?"base":"effect");return 1;
    }
    return 0;
}
int rg_semantic_argument(const char *text,char *json,size_t capacity)
{
    unsigned slot;int i;struct writer out;
    extern char *h_names[],*m_names[];
    if(!text || !json || !capacity)return -1;
    json[0]=0;
    for(slot=0;slot<RG_SEMANTIC_SLOTS;slot++) if(entries[slot].pointer==text && strcmp(entries[slot].english,text)==0) {
        if(strlen(entries[slot].json)>=capacity)return -1;
        strcpy(json,entries[slot].json);return 1;
    }
    init(&out,json,capacity);
    if(text==whoami) {
        append_raw(&out,"{\"type\":\"player_name\"}");return out.valid?1:-1;
    }
    if(text==fruit) {
        append_raw(&out,"{\"type\":\"fruit\",\"value\":");string(&out,fruit);
        formatted(&out,",\"default\":%s}",boolean(strcmp(fruit,"slime-mold")==0));return out.valid?1:-1;
    }
    for(i=0;i<26;i++) if(text==monsters[i].m_name) {
        formatted(&out,"{\"type\":\"monster\",\"index\":%d,\"display\":\"name\",\"article\":\"none\",\"upper\":false,\"hallucinated\":false,\"role\":\"name\"}",i);
        return out.valid?1:-1;
    }
    for(i=0;i<NTRAPS;i++) if(text==tr_name[i]) {formatted(&out,"{\"type\":\"trap\",\"index\":%d}",i);return out.valid?1:-1;}
    /* fire_bolt installs its selected bolt/flame/ice literal into the fake
     * weapon slot. That same pointer also reaches thunk/bounce; it is not a
     * tenth inventory weapon or a name inferred from arbitrary user text. */
    if(text==weap_info[FLAME].oi_name) {
        const char *id=NULL;
        if(!strcmp(text,"bolt"))id="projectile.bolt";
        else if(!strcmp(text,"flame"))id="projectile.flame";
        else if(!strcmp(text,"ice"))id="projectile.ice";
        if(id) {
            append_raw(&out,"{\"type\":\"term\",\"id\":");string(&out,id);append_raw(&out,"}");
            return out.valid?1:-1;
        }
    }
    if(table_name(text,weap_info,MAXWEAPONS,WEAPON,&out) || table_name(text,arm_info,MAXARMORS,ARMOR,&out)
       || table_name(text,pot_info,MAXPOTIONS,POTION,&out) || table_name(text,scr_info,MAXSCROLLS,SCROLL,&out)
       || table_name(text,ring_info,MAXRINGS,RING,&out) || table_name(text,ws_info,MAXSTICKS,STICK,&out)) return out.valid?1:-1;
    for(i=0;i<cNCOLORS;i++) if(text==rainbow[i]) {appearance_argument(&out,"color",i,text);return out.valid?1:-1;}
    for(i=0;i<cNSTONES;i++) if(text==stones[i].st_name) {appearance_argument(&out,"stone",i,text);return out.valid?1:-1;}
    for(i=0;i<cNWOOD;i++) if(text==wood[i]) {appearance_argument(&out,"wood",i,text);return out.valid?1:-1;}
    for(i=0;i<cNMETAL;i++) if(text==metal[i]) {appearance_argument(&out,"metal",i,text);return out.valid?1:-1;}
    /* Restored appearance strings may have their own allocations. Match the
     * assigned original table pointer, never infer an entity from user text. */
    for(i=0;i<MAXPOTIONS;i++) if(text==p_colors[i]) {appearance_argument(&out,"color",appearance_index(text,rainbow,cNCOLORS),text);return out.valid?1:-1;}
    for(i=0;i<MAXRINGS;i++) if(text==r_stones[i]) {appearance_argument(&out,"stone",stone_index(text),text);return out.valid?1:-1;}
    for(i=0;i<MAXSTICKS;i++) if(text==ws_made[i]) {
        int index=appearance_index(text,wood,cNWOOD);
        appearance_argument(&out,index>=0?"wood":"metal",index>=0?index:appearance_index(text,metal,cNMETAL),text);return out.valid?1:-1;
    }
    for(i=0;i<MAXSTICKS;i++) if(text==ws_type[i]) {
        formatted(&out,"{\"type\":\"item_category\",\"category\":\"stick\",\"category_code\":%d",STICK);field_string(&out,"subtype",text);append_raw(&out,"}");return out.valid?1:-1;
    }
    for(i=0;i<MAXSCROLLS;i++) if(text==s_names[i]) {appearance_argument(&out,"scroll_title",-1,text);return out.valid?1:-1;}
    for(i=0;i<8;i++) if(text==h_names[i] || text==m_names[i]) {
        formatted(&out,"{\"type\":\"combat_verb\",\"hit\":%s,\"index\":%d,\"event\":\"%s\",\"variant\":%d}",
            boolean(text==h_names[i]),i,text==h_names[i]?"hit":"miss",i);return out.valid?1:-1;
    }
    return 0;
}
void rg_semantic_copy(const char *text,const char *source)
{
    char json[RG_SEMANTIC_JSON];
    if(rg_semantic_argument(source,json,sizeof json)==1)remember(text,json);
}
void rg_semantic_combatant(const char *text,const char *source,int upper)
{
    char json[RG_SEMANTIC_JSON],result[RG_SEMANTIC_JSON];
    char *position;struct writer out;
    if(!source) {
        rg_semantic_monster(text,-1,"you",0,upper,0);
        source=text;
    }
    if(rg_semantic_argument(source,json,sizeof json)!=1)return;
    position=strstr(json,",\"upper\":");
    if(!position)return;
    *position=0;init(&out,result,sizeof result);append_raw(&out,json);
    /* A combatant has the same chosen monster/pronoun, with a syntactic role.
     * No real hidden monster index is recovered from a hallucinated name. */
    formatted(&out,",\"upper\":%s",boolean(upper));
    position=strchr(position+strlen(",\"upper\":"),',');
    if(!position)return;
    append_raw(&out,position);
    position=strstr(result,"\"role\":\"name\"");
    if(!position)return;
    *position=0;out.length=(size_t)(position-result);
    formatted(&out,"\"role\":\"%s\"}",upper?"subject":"object");
    if(out.valid)remember(text,result);
}
