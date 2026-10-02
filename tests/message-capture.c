/* Focused boundary checks: printf varargs -> typed JSON, safe fallback, and
 * chunk callbacks. This harness never executes downloaded game rules. */
#include <inttypes.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "../logic/message.h"
#include "../logic/semantic.h"
#include "../contract/rogue_abi.h"

static int event_count;
static char last_id[256], last_arguments[40000], last_fallback[2048];
static unsigned ui_count;
static int32_t ui_row, ui_column;
static char ui_scope[128];
extern char fruit[];

void rg_host_message(const char *id, const char *arguments, const char *fallback)
{
    ++event_count;
    snprintf(last_id, sizeof last_id, "%s", id);
    snprintf(last_arguments, sizeof last_arguments, "%s", arguments);
    snprintf(last_fallback, sizeof last_fallback, "%s", fallback);
}
void rg_host_ui(const char *scope,int32_t row,int32_t column,const char *id,
                const char *arguments,const char *fallback)
{
    ++ui_count;ui_row=row;ui_column=column;
    snprintf(ui_scope,sizeof ui_scope,"%s",scope);
    snprintf(last_id,sizeof last_id,"%s",id);
    snprintf(last_arguments,sizeof last_arguments,"%s",arguments);
    snprintf(last_fallback,sizeof last_fallback,"%s",fallback);
}
void rg_host_text_mode(int32_t enabled,uint32_t limit_bytes,const char *initial) {
    (void)enabled;(void)limit_bytes;(void)initial;
}
void rg_host_player_name(const char *name) {(void)name;}

static int capture(char *json, size_t capacity, const char *format, ...)
{
    int result;
    va_list arguments;
    va_start(arguments, format);
    result = rg_message_arguments(format, arguments, json, capacity);
    va_end(arguments);
    return result;
}

static void prepare(struct rg_message_part *part, const char *file, int line,
                    const char *format, ...)
{
    va_list arguments;
    va_start(arguments, format);
    rg_message_prepare(part, file, line, format, arguments);
    va_end(arguments);
}

#define REQUIRE(check) do { if (!(check)) { \
    fprintf(stderr, "message check failed at line %d: %s\n", __LINE__, #check); return 1; \
} } while (0)

int main(void)
{
    char json[4096], small[4];
    struct rg_message_part part;
    int forbidden_write = 77;
    REQUIRE(capture(json, sizeof json, "%*.*d %s %c %ld %%", 7, 3, -12,
                    "日本語\"\\\n\t", 'Z', (long)123456) == 0);
    puts(json);
    REQUIRE(capture(json, sizeof json, "%hhd %hd %lld %jd %zd %td", 255, 65535,
                    (long long)-9223372036854775807LL, (intmax_t)-123,
                    (ptrdiff_t)-456, (ptrdiff_t)789) == 0);
    puts(json);
    REQUIRE(capture(json, sizeof json, "%hhu %hu %u %llu %zu", 256u, 65536u,
                    4294967295u, (unsigned long long)123456789012345ULL,
                    (size_t)42) == 0);
    puts(json);
    REQUIRE(capture(json, sizeof json, "%f %Lf %f", 1.25, (long double)-0.5, INFINITY) == 0);
    puts(json);
    REQUIRE(capture(json, sizeof json, "%s", (const char *)NULL) == 0);
    puts(json);
    REQUIRE(capture(json, sizeof json, "%n", &forbidden_write) == -1);
    REQUIRE(forbidden_write == 77 && strcmp(json, "[]") == 0);
    REQUIRE(capture(json, sizeof json, "%ls", L"wide") == -1);
    REQUIRE(capture(json, sizeof json, "%Ld", 123) == -1);
    REQUIRE(capture(json, sizeof json, "%hhf", 1.0) == -1);
    REQUIRE(capture(json, sizeof json, "incomplete %") == -1);
    REQUIRE(capture(small, sizeof small, "%s", "long value") == -1);
    REQUIRE(strcmp(small, "[]") == 0);

    /* Runtime-composed user text without varargs is literal, even with %. */
    prepare(&part, "unregistered.c", 1, "user's 100% name %n");
    REQUIRE(!strcmp(part.id, "message.legacy"));
    REQUIRE(!strcmp(part.fallback, "user's 100% name %n"));
    rg_message_push(&part);
    rg_message_clear();
    REQUIRE(event_count == 1 && !strcmp(last_id, "message.clear"));
    /* Clearing display must not silently lose an accumulated C addmsg part. */
    rg_message_flush("User's 100% name %n");
    REQUIRE(event_count == 2 && !strcmp(last_id, "message.legacy"));
    REQUIRE(!strcmp(last_fallback, "User's 100% name %n"));
    rg_message_push(&part);
    rg_message_push(&part);
    rg_message_flush("Combined English");
    REQUIRE(event_count == 3 && !strcmp(last_id, "message.sequence"));
    puts(last_arguments);
    REQUIRE(!strcmp(last_fallback, "Combined English"));
    rg_message_discard();
    /* Exercise the actual semantic module: provenance is pointer-based, and
     * equal user text must remain literal instead of gaining game knowledge. */
    REQUIRE(capture(json,sizeof json,"%s",fruit)==0);
    REQUIRE(strstr(json,"\"kind\":\"entity\"") && strstr(json,"\"type\":\"fruit\""));
    {
        char user_text[128];
        snprintf(user_text,sizeof user_text,"%s",fruit);
        REQUIRE(capture(json,sizeof json,"%s",user_text)==0);
        REQUIRE(strstr(json,"\"kind\":\"string\"") && !strstr(json,"\"type\":\"fruit\""));
    }
    rg_ui_printf("inventory",3,2,"unregistered.c",1,"%c) %s",'a',fruit);
    REQUIRE(ui_count==1 && ui_row==3 && ui_column==2 && !strcmp(ui_scope,"inventory"));
    REQUIRE(!strcmp(last_id,"ui.inventory.entry") && strstr(last_arguments,"\"type\":\"fruit\""));
    REQUIRE(strstr(last_arguments,"\"value\":97") && !strcmp(last_fallback,"a) slime-mold"));
    rg_ui_clear("inventory");
    REQUIRE(ui_count==2 && ui_row==-1 && !strcmp(last_id,"message.clear"));
    REQUIRE(!strcmp(last_arguments,"[]") && !strcmp(last_fallback,""));
    puts("{\"checks\":\"pass\"}");
    return 0;
}
