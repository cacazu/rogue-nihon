/* Test-only C message preparation -> real Rust translation -> Worker events. */
#include <stdarg.h>
#include <inttypes.h>
#include "message.h"
#include "semantic.h"
extern char *h_names[], *m_names[];
static int wording_delta;
static const char *wording_item(void) {
    static char text[128]; THING object;
    memset(&object,0,sizeof object);object.o_type=WEAPON;object.o_which=ARROW;
    object.o_count=wording_delta>0?3:1;object.o_flags=ISKNOW;
    object.o_hplus=object.o_dplus=wording_delta;
    snprintf(text,sizeof text,"%s",inv_name(&object,FALSE));
    rg_semantic_item(text,&object,FALSE);return text;
}
static const char *wording_monster(void) {
    static const char text[]="hobgoblin";
    rg_semantic_monster(text,7,"name",0,0,0);return text;
}
static const char *wording_term(void) {
    static const char text[]="throw";rg_semantic_register_term(text,"action.throw");return text;
}
static const char *wording_direction(void) {
    static const char text[]="direction: ";rg_semantic_register_term(text,"prompt.direction");return text;
}
static const char *wording_potion(void) {
    static const char text[]="confused";rg_semantic_register_term(text,"potion.effect.confused");return text;
}
static void wording_site(const char *case_name,const char *expected,const char *file,int line,const char *format,...) {
    struct rg_message_part part;va_list args;
    fprintf(stdout,"WORDING_CASE:%s\n",case_name);
    va_start(args,format);rg_message_prepare(&part,file,line,format,args);va_end(args);
    if(strcmp(part.id,expected)) {fprintf(stderr,"wording site mismatch: %s expected %s got %s\n",case_name,expected,part.id);abort();}
    rg_message_discard();rg_message_push(&part);rg_message_flush(part.fallback);
}
static void wording_direct(const char *case_name,const char *id,const char *args) {
    fprintf(stdout,"WORDING_CASE:%s\n",case_name);rg_host_message(id,args,"");
}
static void wording_clear(const char *case_name,const char *file,int line) {
    fprintf(stdout,"WORDING_CASE:%s\n",case_name);rg_msg(file,line,"");
}
static void wording_catalog_fixture(void) {
#include "wording-cases.generated.inc"
}
