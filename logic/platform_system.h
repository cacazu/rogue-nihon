/* Terminal/host policy replacement. Game rules remain in the original files. */
#include <curses.h>
#include "rogue.h"
#include "core.h"

unsigned int numscores=10;
char *Numname="Ten";
bool allscore=FALSE;
void init_check(void) { }
void open_score(void) {scoreboard=NULL;}
void setup(void) {got_ltc=FALSE;}
void getltchars(void) {got_ltc=FALSE;}
void resetltchars(void) { }
void playltchars(void) { }
void start_score(void) { }
bool is_symlink(char *path) {(void)path;return FALSE;}
bool too_much(void) {return FALSE;}
bool author(void) {return FALSE;}
bool lock_sc(void) {return TRUE;}
void unlock_sc(void) { }
void flush_type(void) {rg_knowledge_flush_input();}
