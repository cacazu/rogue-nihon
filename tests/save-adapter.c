/* Dedicated C-only Web checkpoint test. No Rogue OS-file path is enabled. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "knowledge.h"
#include "rogue.h"
#include "core.h"
#include "state_codec.h"
#include "io_state.h"

static int test_result = 1;
static int checkpoint_seen;
static unsigned checks;
static uint8_t *baseline;
static uint32_t baseline_length;
static uint32_t test_seed=1;

#ifdef RG_ALLOC_AUDIT
struct tracked_allocation {void *pointer;size_t size;};
static struct tracked_allocation allocations[8192];
static size_t live_bytes, live_allocations;
static int allocation_overflow;
static int fail_after=-1;
static unsigned allocation_calls;
void *__real_malloc(size_t);
void *__real_calloc(size_t,size_t);
void *__real_realloc(void *,size_t);
void __real_free(void *);
static void forget(void *pointer) {
    size_t n;
    if(!pointer) return;
    for(n=0;n<8192;n++) if(allocations[n].pointer==pointer) {
        live_bytes-=allocations[n].size;live_allocations--;
        allocations[n].pointer=NULL;allocations[n].size=0;return;
    }
}
static void remember(void *pointer,size_t size) {
    size_t n;
    if(!pointer) return;
    forget(pointer);
    for(n=0;n<8192;n++) if(!allocations[n].pointer) {
        allocations[n].pointer=pointer;allocations[n].size=size;
        live_bytes+=size;live_allocations++;return;
    }
    allocation_overflow=1;
}
void *__wrap_malloc(size_t size) {
    allocation_calls++;
    if(fail_after==0) {fail_after=-1;return NULL;}
    if(fail_after>0) fail_after--;
    void *pointer=__real_malloc(size);remember(pointer,size);return pointer;
}
void *__wrap_calloc(size_t count,size_t size) {
    allocation_calls++;
    if(fail_after==0) {fail_after=-1;return NULL;}
    if(fail_after>0) fail_after--;
    void *pointer=__real_calloc(count,size);remember(pointer,count*size);return pointer;
}
void *__wrap_realloc(void *old,size_t size) {
    allocation_calls++;
    if(fail_after==0) {fail_after=-1;return NULL;}
    if(fail_after>0) fail_after--;
    void *pointer=__real_realloc(old,size);
    if(pointer || size==0) {forget(old);remember(pointer,size);}
    return pointer;
}
void __wrap_free(void *pointer) {forget(pointer);__real_free(pointer);}
#endif

static uint32_t read32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1]<<8) |
        ((uint32_t)p[2]<<16) | ((uint32_t)p[3]<<24);
}
static void write32(uint8_t *p,uint32_t n) {
    p[0]=(uint8_t)n;p[1]=(uint8_t)(n>>8);p[2]=(uint8_t)(n>>16);p[3]=(uint8_t)(n>>24);
}
static uint32_t crcpart(uint32_t crc,const uint8_t *p,uint32_t length) {
    uint32_t n;int b;
    for(n=0;n<length;n++) {
        crc^=p[n];
        for(b=0;b<8;b++) crc=(crc>>1)^(UINT32_C(0xedb88320)&(0u-(crc&1u)));
    }
    return crc;
}
static void checksum(uint8_t *p,uint32_t length) {
    uint32_t crc=crcpart(UINT32_MAX,p,40);
    crc=crcpart(crc,p+44,length-44);
    write32(p+40,crc^UINT32_MAX);
}
static uint32_t marker(uint32_t value) {
    uint32_t n, end=44+read32(baseline+24);
    for(n=44;n+4<=end;n++) if(read32(baseline+n)==value) return n;
    return 0;
}
static int same_state(void) {
    uint8_t *now=NULL;uint32_t length=0;int equal;
    if(rg_core_save_bytes(&now,&length)!=0) return 0;
    equal=length==baseline_length && memcmp(now,baseline,length)==0;
    rg_core_save_free(now);
    return equal;
}
static void check(int condition,const char *name) {
    checks++;
    if(!condition) {
        fprintf(stderr,"SAVE TEST FAILED: %s\n",name);
        test_result=1;
        rg_core_exit(1);
    }
}
static void rejected(uint8_t *bytes,uint32_t length,const char *name) {
    check(rg_core_load_bytes(bytes,length)!=0,name);
    check(same_state(),"failed load leaves complete serialized state intact");
}
static void roundtrip_variant(const char *name) {
    uint8_t *bytes=NULL,*again=NULL;uint32_t length=0,again_length=0;
    uint32_t before[RG_SNAPSHOT_WORDS],after_words[RG_SNAPSHOT_WORDS];
    rg_core_inspect(before,RG_SNAPSHOT_WORDS);
    check(rg_core_save_bytes(&bytes,&length)==0,name);
    check(rg_core_load_bytes(bytes,length)==0,name);
    rg_core_inspect(after_words,RG_SNAPSHOT_WORDS);
    check(memcmp(before,after_words,sizeof before)==0,name);
    check(rg_core_save_bytes(&again,&again_length)==0,name);
    check(length==again_length && memcmp(bytes,again,length)==0,name);
    rg_core_save_free(bytes);rg_core_save_free(again);
    check(rg_core_load_bytes(baseline,baseline_length)==0,"restore normal fixture");
}

void rg_host_present(const uint8_t *cells,uint32_t rows,uint32_t columns) {
    (void)cells;(void)rows;(void)columns;
}
void rg_host_message(const char *id,const char *arguments,const char *english) {
    (void)id;(void)arguments;(void)english;
}
/* Presentation observers cannot consume input or mutate game-owned state. */
void rg_host_ui(const char *scope,int32_t row,int32_t column,const char *id,
                const char *arguments,const char *english) {
    (void)scope;(void)row;(void)column;(void)id;(void)arguments;(void)english;
}
void rg_host_text_mode(int32_t enabled,uint32_t limit_bytes,const char *initial) {
    (void)enabled;(void)limit_bytes;(void)initial;
}
void rg_host_player_name(const char *name) {(void)name;}
void rg_host_outcome(int32_t code,const char *text) {(void)code;(void)text;}
void rg_host_flush_input(void) {}
int32_t rg_host_restore_data(const uint8_t **bytes,uint32_t *length) {
    *bytes=NULL;*length=0;return 0;
}
int32_t rg_host_read_key(void) {rg_core_exit(1);return -1;}

void rg_host_checkpoint(void) {
    uint8_t *changed;
    uint32_t location, n, words[RG_SNAPSHOT_WORDS], restored[RG_SNAPSHOT_WORDS];
    if(checkpoint_seen++) {rg_core_exit(1);return;}
    check(rg_core_save_bytes(&baseline,&baseline_length)==0,"initial boundary captures");
    check(baseline!=NULL && baseline_length>44,"initial container is nonempty");
    rg_core_inspect(words,RG_SNAPSHOT_WORDS);
    {
        uint32_t ll=read32(baseline+24),kl=read32(baseline+28),rl=read32(baseline+32);
        uint32_t runtime_words[128], wc, j, ml;
        const uint8_t *rt=baseline+44+ll+kl;
        wc=read32(rt+8);ml=read32(rt+12);
        for(j=0;j<wc && j<128;j++) runtime_words[j]=read32(rt+16+j*4);
        fprintf(stderr,"SECTIONS logic=%u knowledge=%u runtime=%u knvalid=%d corevalid=%d msgvalid=%d\n",ll,kl,rl,
            rg_knowledge_validate(baseline+44+ll,kl),rg_core_runtime_validate(runtime_words,wc),
            rg_message_state_validate(rt+16+wc*4,ml));
    }
    check(rg_core_load_bytes(baseline,baseline_length)==0,"initial normal state loads");
    rg_core_inspect(restored,RG_SNAPSHOT_WORDS);
    check(memcmp(words,restored,sizeof words)==0,"initial snapshot roundtrip");
    check(same_state(),"initial byte-for-byte roundtrip");
    {
        void (*callbacks[])()={rollwand,doctor,stomach,runners,swander,nohaste,unconfuse,unsee,sight,come_down,visuals,land,(void(*)())turn_see};
        for(n=0;n<13;n++) {
            d_list[n].d_type=2;d_list[n].d_func=callbacks[n];
            d_list[n].d_arg=n==12?1:0;d_list[n].d_time=3;
        }
        roundtrip_variant("all thirteen daemon/fuse callbacks");
    }
    player.t_room=&passages[1];oldrp=&passages[1];
    roundtrip_variant("player and old room passage pointers");
    delta=hero;nh.x=-1;nh.y=hero.y;
    roundtrip_variant("absolute target and rejected edge movement");
    {
        THING *object;
        for(object=pack;object && object->o_type!=FOOD;object=object->l_next) {}
        check(object!=NULL,"initial food object exists");
        cur_weapon=object;
        roundtrip_variant("wielded food is permitted by original rules");
    }
    if(mlist && lvl_obj) {
        mlist->t_dest=&lvl_obj->o_pos;
        roundtrip_variant("monster target resolves to restored level object");
    }
    if(mlist && mlist->l_next) {
        mlist->t_dest=&mlist->l_next->t_pos;
        roundtrip_variant("monster target resolves to restored monster");
    }
    {
        THING *stack,*floor;
        char *label;
        for(stack=pack;stack && !(stack->o_type==WEAPON && stack->o_count>1);stack=stack->l_next) {}
        check(stack!=NULL && stack->o_label==NULL,"initial stack for shared-label ownership");
        label=malloc(7);check(label!=NULL,"shared-label allocation");strcpy(label,"shared");
        stack->o_label=label;floor=new_item();check(floor!=NULL,"split floor object");
        *floor=*stack;floor->l_next=floor->l_prev=NULL;floor->o_count=1;floor->o_pos=hero;
        attach(lvl_obj,floor);
        roundtrip_variant("shared pack/floor label is released exactly once");
    }
    changed=malloc(baseline_length);
    check(changed!=NULL,"test allocation");
    rejected(baseline,0,"zero length");
    rejected(baseline,43,"short header");
    rejected(baseline,baseline_length-1,"truncated payload");
    memcpy(changed,baseline,baseline_length);changed[36]^=1;
    rejected(changed,baseline_length,"CRC covers turn header");
    memcpy(changed,baseline,baseline_length);changed[44]^=1;
    rejected(changed,baseline_length,"CRC covers logic payload");
    memcpy(changed,baseline,baseline_length);write32(changed+12,1);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"historical logic schema rejected");
    memcpy(changed,baseline,baseline_length);write32(changed+36,read32(changed+36)+1);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid turn/runtime mismatch");
    {
        uint32_t ll=read32(baseline+24),kl=read32(baseline+28),knowledge=44+ll,runtime=knowledge+kl;
        memcpy(changed,baseline,baseline_length);
        memmove(changed+44+ll-1,changed+44+ll,baseline_length-44-ll);
        write32(changed+24,ll-1);checksum(changed,baseline_length-1);
        rejected(changed,baseline_length-1,"CRC-valid truncated logic with intact other sections");
        memcpy(changed,baseline,baseline_length);changed[knowledge+16]=0;checksum(changed,baseline_length);
        rejected(changed,baseline_length,"CRC-valid knowledge glyph invalid");
        memcpy(changed,baseline,baseline_length);changed[knowledge+17]=2;checksum(changed,baseline_length);
        rejected(changed,baseline_length,"CRC-valid knowledge attribute invalid");
        memcpy(changed,baseline,baseline_length);write32(changed+runtime+8,129);checksum(changed,baseline_length);
        rejected(changed,baseline_length,"CRC-valid excessive runtime words");
        memcpy(changed,baseline,baseline_length);write32(changed+runtime+16+17*4+4,143);checksum(changed,baseline_length);
        rejected(changed,baseline_length,"CRC-valid message position invalid");
    }
    location=marker(UINT32_C(0xabcd0007));
    check(location!=0,"object-list marker found");
    memcpy(changed,baseline,baseline_length);write32(changed+location+4,UINT32_MAX);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid negative object count");
    memcpy(changed,baseline,baseline_length);write32(changed+location+4,16385);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid excessive object count");
    location=marker(UINT32_C(0xabcd000e));
    check(location!=0,"daemon marker found");
    memcpy(changed,baseline,baseline_length);write32(changed+location+12,14);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid unknown daemon callback");
    memcpy(changed,baseline,baseline_length);write32(changed+location+4,19);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid daemon count mismatch");
    /* Schema-2 THING: 30 bytes before stats; stats is 45 bytes; then room ID. */
    location=marker(UINT32_C(0xabcd0002));
    check(location!=0 && read32(baseline+location+30)==UINT32_C(0xabcd0001),"player stats layout");
    memcpy(changed,baseline,baseline_length);write32(changed+location+75,MAXROOMS+MAXPASS);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid room index out of bounds");
    memcpy(changed,baseline,baseline_length);write32(changed+location+75,UINT32_MAX);checksum(changed,baseline_length);
    rejected(changed,baseline_length,"CRC-valid missing player room");
#ifdef RG_ALLOC_AUDIT
    {
        unsigned before_calls=allocation_calls,load_calls,j;
        size_t warm_bytes=live_bytes,warm_allocations=live_allocations;
        check(rg_core_load_bytes(baseline,baseline_length)==0,"allocation fault fixture warmup");
        load_calls=allocation_calls-before_calls;
        for(j=0;j<load_calls;j++) {
            fail_after=(int)j;
            check(rg_core_load_bytes(baseline,baseline_length)!=0,"every allocation failure rejects atomically");
            fail_after=-1;
            check(same_state(),"allocation failure preserves complete serialized state");
            check(live_bytes==warm_bytes && live_allocations==warm_allocations,
                "failed allocation leaves no additional live allocations");
        }
        fprintf(stderr,"ALLOC fault_injections=%u rollback_and_live_bytes_stable=true\n",load_calls);
    }
#endif
    /* Warm allocator/stdio once before checking sustained live allocations. */
    check(rg_core_load_bytes(baseline,baseline_length)==0,"allocator warmup");
#ifdef RG_ALLOC_AUDIT
    {
        size_t warm_bytes=live_bytes,warm_allocations=live_allocations;
#endif
    for(n=0;n<128;n++) {
        check(rg_core_load_bytes(baseline,baseline_length)==0,"repeated load");
        check(same_state(),"repeated load preserves bytes");
    }
#ifdef RG_ALLOC_AUDIT
        check(!allocation_overflow && live_bytes==warm_bytes && live_allocations==warm_allocations,
            "128 repeated loads retain no additional live allocations");
        fprintf(stderr,"ALLOC live_count=%zu live_bytes=%zu stable_after_128=true\n",live_allocations,live_bytes);
    }
#endif
    free(changed);
    rg_core_save_free(baseline);baseline=NULL;
    test_result=0;
    fprintf(stdout,"{\"save_adapter\":\"pass\",\"seed\":%u,\"checks\":%u,\"repeated_loads\":128}\n",test_seed,checks);
    rg_core_exit(0);
}

int main(int argc,char **argv) {
    int32_t result;
    uint8_t *uninitialized=(uint8_t *)(uintptr_t)1;uint32_t uninitialized_length=1;
    if(rg_core_save_bytes(&uninitialized,&uninitialized_length)==0 ||
        uninitialized!=NULL || uninitialized_length!=0 ||
        rg_core_load_bytes((const uint8_t *)"x",1)==0) return 1;
    checks+=2;
    if(argc>1) test_seed=(uint32_t)strtoul(argv[1],NULL,10);
    result=rg_core_start(test_seed,"SaveTest");
    if(result!=0 || !checkpoint_seen) return 1;
    return test_result;
}
