/* Exercise the real io.c message path with deterministic, side-effect-free
 * screen/input stubs. Paging and private checkpoint state are game-owned. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <curses.h>
#include "../logic/rogue.h"
#include "../logic/io_state.h"
#undef abort /* This focused fixture uses libc abort for a failed invariant. */

static int look_count, input_count, event_count;
static char event_id[256], event_text[2048];

int move(int y, int x) { (void)y; (void)x; return OK; }
int clrtoeol(void) { return OK; }
int mvaddstr(int y, int x, const char *text) { (void)y; (void)x; (void)text; return OK; }
int refresh(void) { return OK; }
void look(bool wakeup) { if (wakeup) abort(); ++look_count; }
int md_readchar(void) { ++input_count; return ' '; }
void quit(int ignored) { (void)ignored; abort(); }
void rg_host_message(const char *id, const char *arguments, const char *fallback)
{
    (void)arguments;
    ++event_count;
    snprintf(event_id, sizeof event_id, "%s", id);
    snprintf(event_text, sizeof event_text, "%s", fallback);
}
/* These observer callbacks deliberately leave all paging and input state alone. */
void rg_host_ui(const char *scope,int32_t row,int32_t column,const char *id,
                const char *arguments,const char *english) {
    (void)scope;(void)row;(void)column;(void)id;(void)arguments;(void)english;
}
void rg_host_text_mode(int32_t enabled,uint32_t limit_bytes,const char *initial) {
    (void)enabled;(void)limit_bytes;(void)initial;
}
void rg_host_player_name(const char *name) {(void)name;}

#define REQUIRE(check) do { if (!(check)) { \
    fprintf(stderr, "paging check failed at line %d: %s\n", __LINE__, #check); return 1; \
} } while (0)

int main(void)
{
    uint8_t *checkpoint = NULL, *after = NULL;
    uint32_t length = 0, after_length = 0;
    int saved_mpos;
    char long_name[2048];
    rg_msg("unregistered.c", 1, "old line");
    REQUIRE(!strcmp(event_text, "Old line") && mpos == 8);
    REQUIRE(look_count == 0 && input_count == 0);
    rg_addmsg("unregistered.c", 1, "partial ");
    saved_mpos = mpos;
    REQUIRE(rg_message_state_export(&checkpoint, &length) == 0);
    REQUIRE(length == 151 && rg_message_state_validate(checkpoint, length) == 0);
    REQUIRE(rg_message_state_validate(checkpoint, length - 1) == -1);
    checkpoint[0] = 2;
    REQUIRE(rg_message_state_import(checkpoint, length) == -1);
    checkpoint[0] = 1;
    checkpoint[4] = 255;
    REQUIRE(rg_message_state_validate(checkpoint, length) == -1);
    checkpoint[4] = 8;
    checkpoint[8] = '\0';
    REQUIRE(rg_message_state_validate(checkpoint, length) == -1);
    checkpoint[8] = 'p';
    REQUIRE(rg_message_state_export(&after, &after_length) == 0);
    REQUIRE(after_length == length && !memcmp(checkpoint, after, length));
    free(after);
    after = NULL;

    rg_msg("unregistered.c", 1, "second");
    REQUIRE(look_count == 1 && input_count == 1);
    REQUIRE(!strcmp(event_text, "Partial second"));
    mpos = saved_mpos; /* state.c restores this global independently. */
    REQUIRE(rg_message_state_import(checkpoint, length) == 0);
    REQUIRE(endmsg() == ~ESCAPE);
    REQUIRE(look_count == 2 && input_count == 2 && mpos == 8);
    REQUIRE(!strcmp(event_id, "message.legacy"));
    REQUIRE(!strcmp(event_text, "Partial ") && !strcmp(huh, "partial "));
    free(checkpoint);

    /* Display clearing preserves a pending addmsg chain, as upstream does. */
    rg_addmsg("unregistered.c", 1, "kept");
    rg_msg("unregistered.c", 1, "");
    REQUIRE(!strcmp(event_id, "message.clear") && mpos == 0);
    endmsg();
    REQUIRE(!strcmp(event_text, "Kept") && look_count == 2);

    /* Very long dynamic text now remains within the original 143-byte buffer. */
    memset(long_name, 'x', sizeof long_name - 1);
    long_name[sizeof long_name - 1] = '\0';
    rg_msg("unregistered.c", 1, long_name);
    REQUIRE(strlen(huh) == 142 && mpos == 142 && strlen(event_text) == 142);
    REQUIRE(rg_message_state_export(&after, &after_length) == 0);
    REQUIRE(rg_message_state_validate(after, after_length) == 0);
    free(after);
    puts("{\"englishPaging\":\"pass\",\"privateCheckpoint\":\"pass\",\"malformedCheckpoint\":\"pass\",\"boundedMessage\":\"pass\"}");
    return 0;
}
