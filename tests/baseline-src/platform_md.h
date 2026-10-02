/* Portable machine services. Included only by mdport.c's layered branch. */
#include <curses.h>
#include "rogue.h"
#include "core.h"
#include <string.h>
#include <errno.h>

void md_init(void) { }
void md_onsignal_default(void) { }
void md_onsignal_exit(void) { }
void md_onsignal_autosave(void) { }
void md_ignoreallsignals(void) { }
void md_tstphold(void) { }
void md_tstpresume(void) { }
void md_tstpsignal(void) { }
void md_start_checkout_timer(int seconds) {(void)seconds;}
void md_stop_checkout_timer(void) { }
int md_hasclreol(void) {return TRUE;}
void md_putchar(int c) {rg_console_putchar(c);}
void md_raw_standout(void) {standout();}
void md_raw_standend(void) {standend();}
int md_unlink_open_file(char *path,FILE *ignored) {(void)path;(void)ignored;return 0;}
int md_unlink(char *path) {(void)path;return 0;}
int md_chmod(char *path,int mode) {(void)path;(void)mode;return 0;}
void md_normaluser(void) { }
int md_getuid(void) {return 0;}
int md_getpid(void) {return 0;}
char *md_getusername(void) {return (char*)rg_core_player_name();}
char *md_gethomedir(void) {return "";}
void md_sleep(int seconds) {(void)seconds;}
char *md_getshell(void) {return "";}
int md_shellescape(void) {msg("The browser has no operating-system shell.");return 0;}
char *md_getrealname(int uid) {(void)uid;return (char*)rg_core_player_name();}
char *md_crypt(char *key,char *salt) {(void)salt;return key;}
char *md_getpass(char *prompt) {static char buffer[MAXSTR];msg("%s",prompt);wgetnstr(stdscr,buffer,MAXSTR-1);return buffer;}
int md_erasechar(void) {return erasechar();}
int md_killchar(void) {return killchar();}
int md_dsuspchar(void) {return 0;}
int md_setdsuspchar(int c) {(void)c;return 0;}
int md_suspchar(void) {return 0;}
int md_setsuspchar(int c) {(void)c;return 0;}
int md_readchar(void) {return getch();}
int md_loadav(double *average) {if(average)*average=0;return 0;}
int md_issymlink(char *path) {(void)path;return 0;}
