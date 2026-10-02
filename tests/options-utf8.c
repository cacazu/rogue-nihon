/* Exercise production get_str/strucpy with deterministic byte input and a
 * side-effect-free screen. No test-only changes to the string editor. */
#include <curses.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "rogue.h"
#include "rogue_abi.h"

static WINDOW screen, panel;
WINDOW *stdscr = &screen, *curscr = &screen, *hw = &panel;
char home[MAXSTR] = "/", whoami[MAXSTR] = "Tester", fruit[MAXSTR] = "slime-mold";
int mpos;
static const unsigned char *events;
static size_t event_index, event_count;
static int starts, finishes, bells, checks;
static char last_name[MAXSTR], last_final[MAXSTR];
static int expected_mode;

#define REQUIRE(value) do { ++checks; if (!(value)) { fprintf(stderr, "UTF8 check failed at line %d: %s\n", __LINE__, #value); exit(1); } } while (0)
#undef exit

char readchar(void) { REQUIRE(event_index < event_count); return (char)events[event_index++]; }
int rg_console_putchar(int ch) { if (ch == CTRL('G')) ++bells; return ch; }
int wrefresh(WINDOW *win) { (void)win; return OK; }
int wclrtoeol(WINDOW *win) { (void)win; return OK; }
int wmove(WINDOW *win, int row, int column) { win->_cury = row; win->_curx = column; return OK; }
int waddch(WINDOW *win, chtype ch) { if (ch == '\b') --win->_curx; else ++win->_curx; return OK; }
int waddstr(WINDOW *win, const char *text) { win->_curx += (int)strlen(text); return OK; }
int mvwprintw(WINDOW *win, int row, int column, const char *fmt, ...) { (void)fmt; return wmove(win, row, column); }
int erasechar(void) { return 8; }
int killchar(void) { return CTRL('U'); }
const char *unctrl(chtype ch) { static char text[3]; text[0] = (char)ch; text[1] = '\0'; return text; }
void rg_ui_printf(const char *scope, int row, int col, const char *file, int line, const char *fmt, ...)
{ (void)scope; (void)row; (void)col; (void)file; (void)line; (void)fmt; }
void rg_host_text_mode(int enabled, uint32_t limit, const char *initial)
{
    if (enabled) { ++starts; REQUIRE(enabled == expected_mode); REQUIRE(limit == 50); REQUIRE(initial != NULL); }
    else { ++finishes; REQUIRE(limit == 0); snprintf(last_final, sizeof last_final, "%s", initial); }
}
void rg_host_player_name(const char *name) { snprintf(last_name, sizeof last_name, "%s", name); }

static int edit(char *value, WINDOW *window, const unsigned char *input, size_t count)
{
    int before_starts = starts, before_finishes = finishes, result;
    events = input; event_index = 0; event_count = count;
    expected_mode = value == whoami ? 2 : value == fruit ? 3 : 1;
    window->_curx = window->_cury = 0;
    result = get_str(value, window);
    REQUIRE(event_index == event_count);
    REQUIRE(starts == before_starts + 1 && finishes == before_finishes + 1);
    REQUIRE(!strcmp(last_final, value));
    return result;
}

int main(void)
{
    char value[MAXSTR], long_input[64], invalid[] = {'A', (char)0xc0, (char)0xaf, 'B', (char)0xed, (char)0xa0, (char)0x80, 'C', (char)0xf4, (char)0x90, (char)0x80, (char)0x80, 'D', 0};
    static const unsigned char japanese[] = "\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e\xf0\x9f\x98\x80\010\n";
    strcpy(value, "old");
    REQUIRE(edit(value, hw, (const unsigned char *)"ABC\010D\n", 6) == NORM);
    REQUIRE(!strcmp(value, "ABD"));
    REQUIRE(edit(value, hw, japanese, sizeof japanese - 1) == NORM);
    REQUIRE(!strcmp(value, "\xe6\x97\xa5\xe6\x9c\xac\xe8\xaa\x9e"));
    REQUIRE(edit(whoami, hw, (const unsigned char *)"\xe7\x8e\xa9\xe5\xae\xb6\n", 7) == NORM);
    REQUIRE(!strcmp(whoami, "\xe7\x8e\xa9\xe5\xae\xb6") && !strcmp(last_name, whoami));
    REQUIRE(edit(fruit, hw, (const unsigned char *)"\n", 1) == NORM);
    REQUIRE(!strcmp(fruit, "slime-mold"));
    memset(long_input, 'a', 49); memcpy(long_input + 49, "\xe6\x97\xa5\n", 4);
    REQUIRE(edit(value, hw, (const unsigned char *)long_input, 53) == NORM);
    REQUIRE(strlen(value) == 49 && bells == 2);
    strucpy(value, invalid, (int)strlen(invalid)); REQUIRE(!strcmp(value, "ABCD"));
    strucpy(value, "\xf0\x9f\x98\x80", 3); REQUIRE(value[0] == '\0');
    strucpy(value, "\xe6\x97\xa5", 3); REQUIRE(!strcmp(value, "\xe6\x97\xa5"));
    strcpy(value, "keep"); REQUIRE(edit(value, hw, (const unsigned char *)"-", 1) == MINUS && !strcmp(value, "keep"));
    REQUIRE(edit(value, hw, (const unsigned char *)"cancel\033", 7) == QUIT && !strcmp(value, "cancel"));
    REQUIRE(edit(value, stdscr, (const unsigned char *)"x\025\n", 3) == NORM && !strcmp(value, "cancel"));
    fprintf(stdout, "{\"checks\":%d,\"utf8ScalarBackspace\":\"pass\",\"byteLimit\":\"pass\",\"malformedUtf8\":\"pass\",\"asciiBehavior\":\"pass\",\"playerNameCallback\":\"pass\"}\n", checks);
    return 0;
}
