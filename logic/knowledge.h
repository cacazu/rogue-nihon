/* In-memory curses compatibility.  This is game knowledge, never a host UI. */
#ifndef RG_KNOWLEDGE_H
#define RG_KNOWLEDGE_H
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdarg.h>
#include <stdbool.h>

#define TRUE 1
#define FALSE 0
#define OK 0
#define ERR (-1)
#define A_CHARTEXT 0xffu
#define A_STANDOUT 0x100u
#define A_NORMAL 0u
typedef uint16_t chtype;
typedef struct rg_window {
    int _cury, _curx;
    int _maxy, _maxx, _begy, _begx;
    unsigned _attrs;
    uint16_t *_cells;
    int _stride, _owns_cells;
} WINDOW;
extern WINDOW *stdscr, *curscr;
extern int LINES, COLS;

#define getyx(w,y,x) ((y)=(w)->_cury,(x)=(w)->_curx)
#define getmaxy(w) ((w)->_maxy)
#define getmaxx(w) ((w)->_maxx)
#define getbegy(w) ((w)->_begy)
#define getbegx(w) ((w)->_begx)

WINDOW *initscr(void);
WINDOW *newwin(int rows,int cols,int y,int x);
WINDOW *subwin(WINDOW *parent,int rows,int cols,int y,int x);
int delwin(WINDOW *win);
int endwin(void);
int isendwin(void);
int wmove(WINDOW *win,int y,int x);
int move(int y,int x);
int mvwin(WINDOW *win,int y,int x);
int waddch(WINDOW *win,const chtype ch);
int addch(const chtype ch);
int mvwaddch(WINDOW *win,int y,int x,const chtype ch);
int mvaddch(int y,int x,const chtype ch);
int waddstr(WINDOW *win,const char *text);
int addstr(const char *text);
int mvaddstr(int y,int x,const char *text);
int mvwaddstr(WINDOW *win,int y,int x,const char *text);
int wprintw(WINDOW *win,const char *fmt,...);
int printw(const char *fmt,...);
int mvwprintw(WINDOW *win,int y,int x,const char *fmt,...);
int mvprintw(int y,int x,const char *fmt,...);
int wclrtoeol(WINDOW *win);
int clrtoeol(void);
int werase(WINDOW *win);
int wclear(WINDOW *win);
int clear(void);
int erase(void);
chtype winch(WINDOW *win);
chtype inch(void);
chtype mvwinch(WINDOW *win,int y,int x);
chtype mvinch(int y,int x);
int wstandout(WINDOW *win);
int wstandend(WINDOW *win);
int standout(void);
int standend(void);
int wrefresh(WINDOW *win);
int refresh(void);
int touchwin(WINDOW *win);
int clearok(WINDOW *win,bool enabled);
int leaveok(WINDOW *win,bool enabled);
int idlok(WINDOW *win,bool enabled);
int keypad(WINDOW *win,bool enabled);
int raw(void);
int noecho(void);
int baudrate(void);
int mvcur(int oldy,int oldx,int newy,int newx);
int getch(void);
int wgetch(WINDOW *win);
int wgetnstr(WINDOW *win,char *text,int length);
int erasechar(void);
int killchar(void);
const char *unctrl(chtype ch);

/* These operations read/copy knowledge without look(), daemons or RNG. */
void rg_knowledge_present(void);
const uint8_t *rg_knowledge_view(void);
const uint16_t *rg_knowledge_cells(void);
int rg_knowledge_export(uint8_t **out,uint32_t *length);
int rg_knowledge_validate(const uint8_t *data,uint32_t length);
int rg_knowledge_import(const uint8_t *data,uint32_t length);
/* Queue flush belongs to input, not the game renderer. */
void rg_knowledge_flush_input(void);
#endif
