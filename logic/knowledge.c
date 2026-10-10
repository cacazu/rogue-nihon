/* Portable virtual screen; no terminal, DOM, timing, or game updates. */
#include "knowledge.h"
#include "core.h"
#include "semantic.h"
#include "../contract/rogue_abi.h"
#include <stdlib.h>
#include <string.h>
#include <limits.h>

#define RG_ROWS 24
#define RG_COLS 80
#define RG_KN_BYTES (16u + 2u*RG_ROWS*RG_COLS)
WINDOW *stdscr, *curscr;
int LINES=RG_ROWS, COLS=RG_COLS;
static int ended;
static uint8_t view[RG_ROWS*RG_COLS];

static uint16_t *cell(WINDOW *win,int y,int x) {
    return win->_cells+y*win->_stride+x;
}
static int valid(WINDOW *win,int y,int x) {
    return win && y>=0 && x>=0 && y<win->_maxy && x<win->_maxx;
}
WINDOW *newwin(int rows,int cols,int y,int x) {
    WINDOW *w;
    if(rows==0) rows=LINES-y;
    if(cols==0) cols=COLS-x;
    if(rows<1 || cols<1 || rows>RG_ROWS || cols>RG_COLS || y<0 || x<0 || y+rows>LINES || x+cols>COLS)
        return NULL;
    w=(WINDOW*)calloc(1,sizeof(*w));
    if(!w) return NULL;
    w->_cells=(uint16_t*)malloc((size_t)rows*cols*sizeof(uint16_t));
    if(!w->_cells) {free(w); return NULL;}
    w->_maxy=rows; w->_maxx=cols; w->_begy=y; w->_begx=x;
    w->_stride=cols; w->_owns_cells=1;
    werase(w);
    return w;
}
WINDOW *initscr(void) {
    if(!stdscr) stdscr=newwin(LINES,COLS,0,0);
    if(!curscr) curscr=newwin(LINES,COLS,0,0);
    ended=0;
    return stdscr;
}
WINDOW *subwin(WINDOW *parent,int rows,int cols,int y,int x) {
    WINDOW *w;
    int ry,rx;
    if(!parent) return NULL;
    ry=y-parent->_begy; rx=x-parent->_begx;
    if(rows==0) rows=parent->_maxy-ry;
    if(cols==0) cols=parent->_maxx-rx;
    if(ry<0 || rx<0 || rows<1 || cols<1 || ry+rows>parent->_maxy || rx+cols>parent->_maxx)
        return NULL;
    w=(WINDOW*)calloc(1,sizeof(*w));
    if(!w) return NULL;
    w->_maxy=rows; w->_maxx=cols; w->_begy=y; w->_begx=x;
    w->_cells=cell(parent,ry,rx); w->_stride=parent->_stride;
    return w;
}
int delwin(WINDOW *win) {
    /* Upstream frees the terminal windows in score(); retain final knowledge. */
    if(!win) return ERR;
    if(win==stdscr || win==curscr) return OK;
    if(win->_owns_cells) free(win->_cells);
    free(win);
    return OK;
}
int endwin(void) { ended=1; return OK; }
int isendwin(void) { return ended; }
int wmove(WINDOW *win,int y,int x) {
    if(!valid(win,y,x)) return ERR;
    win->_cury=y; win->_curx=x; return OK;
}
int move(int y,int x) { return wmove(stdscr,y,x); }
int mvwin(WINDOW *win,int y,int x) {
    if(!win || y<0 || x<0 || y+win->_maxy>LINES || x+win->_maxx>COLS) return ERR;
    win->_begy=y; win->_begx=x; return OK;
}
int wclrtoeol(WINDOW *win) {
    int x;
    if(!valid(win,win?win->_cury:0,win?win->_curx:0)) return ERR;
    for(x=win->_curx;x<win->_maxx;x++) *cell(win,win->_cury,x)=' '|win->_attrs;
    return OK;
}
int clrtoeol(void) { return wclrtoeol(stdscr); }
int werase(WINDOW *win) {
    int y,x;
    if(!win) return ERR;
    for(y=0;y<win->_maxy;y++) for(x=0;x<win->_maxx;x++) *cell(win,y,x)=' ';
    win->_cury=win->_curx=0; return OK;
}
int wclear(WINDOW *win) {return werase(win);}
int clear(void) {return werase(stdscr);}
int erase(void) {return werase(stdscr);}
int waddch(WINDOW *win,const chtype value) {
    unsigned char ch=(unsigned char)(value&A_CHARTEXT);
    int n,result=OK;
    if(!valid(win,win?win->_cury:0,win?win->_curx:0)) return ERR;
    if(ch=='\n') {
        wclrtoeol(win); win->_curx=0;
        if(win->_cury+1<win->_maxy) win->_cury++; else result=ERR;
        return result;
    }
    if(ch=='\r') {win->_curx=0;return OK;}
    if(ch=='\b') {if(win->_curx>0) win->_curx--;return OK;}
    if(ch=='\t') {
        n=8-(win->_curx%8);
        while(n--) if(waddch(win,' ')==ERR) result=ERR;
        return result;
    }
    *cell(win,win->_cury,win->_curx)=(value&A_CHARTEXT)|(value&A_STANDOUT)|win->_attrs;
    if(++win->_curx>=win->_maxx) {
        if(win->_cury+1<win->_maxy) {win->_curx=0;win->_cury++;}
        else {win->_curx=win->_maxx-1;result=ERR;}
    }
    return result;
}
int addch(const chtype c) {return waddch(stdscr,c);}
int mvwaddch(WINDOW*w,int y,int x,const chtype c) {return wmove(w,y,x)==ERR?ERR:waddch(w,c);}
int mvaddch(int y,int x,const chtype c) {return mvwaddch(stdscr,y,x,c);}
int waddstr(WINDOW*w,const char*s) {
    int result=OK;
    if(!w || !s) return ERR;
    /* Original logical cells remain ASCII. A user-entered UTF-8 string uses
     * one safe placeholder per byte here; semantic UI keeps the full string.
     * Translations never enter this knowledge buffer or its RNG consumers. */
    while(*s) {
        unsigned char ch=(unsigned char)*s++;
        if(waddch(w,ch>=128?'?':ch)==ERR) result=ERR;
    }
    return result;
}
int addstr(const char*s) {return waddstr(stdscr,s);}
int mvwaddstr(WINDOW*w,int y,int x,const char*s) {return wmove(w,y,x)==ERR?ERR:waddstr(w,s);}
int mvaddstr(int y,int x,const char*s) {return mvwaddstr(stdscr,y,x,s);}
static int print_args(WINDOW*w,const char*f,va_list args) {
    char local[4096];
    int n;
    if(!f) return ERR;
    n=vsnprintf(local,sizeof(local),f,args);
    if(n<0 || (size_t)n>=sizeof(local)) return ERR;
    return waddstr(w,local);
}
int wprintw(WINDOW*w,const char*f,...) {int r;va_list a;va_start(a,f);r=print_args(w,f,a);va_end(a);return r;}
int printw(const char*f,...) {int r;va_list a;va_start(a,f);r=print_args(stdscr,f,a);va_end(a);return r;}
int mvwprintw(WINDOW*w,int y,int x,const char*f,...) {int r;va_list a;if(wmove(w,y,x)==ERR)return ERR;va_start(a,f);r=print_args(w,f,a);va_end(a);return r;}
int mvprintw(int y,int x,const char*f,...) {int r;va_list a;if(wmove(stdscr,y,x)==ERR)return ERR;va_start(a,f);r=print_args(stdscr,f,a);va_end(a);return r;}
chtype winch(WINDOW*w) {return valid(w,w?w->_cury:0,w?w->_curx:0)?*cell(w,w->_cury,w->_curx):' ';}
chtype inch(void) {return winch(stdscr);}
chtype mvwinch(WINDOW*w,int y,int x) {return wmove(w,y,x)==ERR?' ':winch(w);}
chtype mvinch(int y,int x) {return mvwinch(stdscr,y,x);}
int wstandout(WINDOW*w) {if(!w)return ERR;w->_attrs=A_STANDOUT;return OK;}
int wstandend(WINDOW*w) {if(!w)return ERR;w->_attrs=0;return OK;}
int standout(void) {return wstandout(stdscr);}
int standend(void) {return wstandend(stdscr);}
const uint8_t *rg_knowledge_view(void) {
    int i;
    if(!curscr) return NULL;
    for(i=0;i<RG_ROWS*RG_COLS;i++) view[i]=(uint8_t)curscr->_cells[i];
    return view;
}
const uint16_t *rg_knowledge_cells(void) {return stdscr?stdscr->_cells:NULL;}
void rg_knowledge_present(void) {
    const uint8_t *bytes=rg_knowledge_view();
    if(bytes) {
        rg_semantic_map_terrain(bytes,RG_ROWS,RG_COLS);
        rg_host_present(bytes,RG_ROWS,RG_COLS);
    }
}
int wrefresh(WINDOW*w) {
    int y,x,dy,dx;
    if(!w || !curscr) return ERR;
    if(w!=curscr) {
        for(y=0;y<w->_maxy;y++) for(x=0;x<w->_maxx;x++) {
            dy=w->_begy+y; dx=w->_begx+x;
            if(valid(curscr,dy,dx)) *cell(curscr,dy,dx)=*cell(w,y,x);
        }
        curscr->_cury=w->_begy+w->_cury; curscr->_curx=w->_begx+w->_curx;
    }
    ended=0;
    rg_knowledge_present();
    return OK;
}
int refresh(void) {return wrefresh(stdscr);}
int touchwin(WINDOW*w) {return w?OK:ERR;}
int clearok(WINDOW*w,bool e) {(void)e;return w?OK:ERR;}
int leaveok(WINDOW*w,bool e) {(void)e;return w?OK:ERR;}
int idlok(WINDOW*w,bool e) {(void)e;return w?OK:ERR;}
int keypad(WINDOW*w,bool e) {(void)e;return w?OK:ERR;}
int raw(void) {return OK;}
int noecho(void) {return OK;}
int baudrate(void) {return 38400;}
int mvcur(int oy,int ox,int y,int x) {(void)oy;(void)ox;return wmove(curscr,y,x);}
int getch(void) {
    int key;
    rg_core_pending(1);
    key=rg_host_read_key();
    rg_core_pending(0);
    /* The Rust input callback has returned before the C lifetime jump. */
    if(key<0) {rg_core_set_outcome(-1,"input ended");rg_core_exit(-1);}
    return key;
}
int wgetch(WINDOW*w) {(void)w;return getch();}
int wgetnstr(WINDOW*w,char*text,int length) {
    int n=0,ch;
    if(!w || !text || length<0) return ERR;
    while((ch=getch())!='\n' && ch!='\r') {
        if(ch<0) {text[n]=0;return ERR;}
        if(ch==8 || ch==127) {if(n) n--;continue;}
        if(ch>=32 && ch<=126 && n<length) text[n++]=(char)ch;
    }
    text[n]=0;return OK;
}
int erasechar(void) {return 8;}
int killchar(void) {return 21;}
const char *unctrl(chtype value) {
    static char buffer[3];
    unsigned ch=value&127u;
    if(ch<32u) {buffer[0]='^';buffer[1]=(char)(ch+'@');buffer[2]=0;}
    else if(ch==127u) {buffer[0]='^';buffer[1]='?';buffer[2]=0;}
    else {buffer[0]=(char)ch;buffer[1]=0;}
    return buffer;
}
/* The host owns pending physical input. Clearing it must not invent game input. */
void rg_knowledge_flush_input(void) {rg_host_flush_input();}
static void put16(uint8_t*p,unsigned n) {p[0]=(uint8_t)n;p[1]=(uint8_t)(n>>8);}
static unsigned get16(const uint8_t*p) {return p[0]|((unsigned)p[1]<<8);}
int rg_knowledge_export(uint8_t **out,uint32_t *length) {
    uint8_t *p;
    int i;
    if(!out || !length || !stdscr) return -1;
    *out=NULL;*length=0;
    p=(uint8_t*)malloc(RG_KN_BYTES);
    if(!p) return -1;
    memcpy(p,"RGKN",4);put16(p+4,1);put16(p+6,RG_ROWS);put16(p+8,RG_COLS);
    put16(p+10,(unsigned)stdscr->_cury);put16(p+12,(unsigned)stdscr->_curx);put16(p+14,stdscr->_attrs?1:0);
    for(i=0;i<RG_ROWS*RG_COLS;i++) {p[16+2*i]=(uint8_t)stdscr->_cells[i];p[17+2*i]=(stdscr->_cells[i]&A_STANDOUT)?1:0;}
    *out=p;*length=RG_KN_BYTES;return 0;
}
int rg_knowledge_validate(const uint8_t *p,uint32_t n) {
    int i;
    if(!p || n!=RG_KN_BYTES || memcmp(p,"RGKN",4) || get16(p+4)!=1 || get16(p+6)!=RG_ROWS || get16(p+8)!=RG_COLS || get16(p+10)>=RG_ROWS || get16(p+12)>=RG_COLS || get16(p+14)>1) return -1;
    for(i=0;i<RG_ROWS*RG_COLS;i++) if(p[16+2*i]<32 || p[16+2*i]>126 || p[17+2*i]>1) return -1;
    return 0;
}
int rg_knowledge_import(const uint8_t *p,uint32_t n) {
    int i;
    if(rg_knowledge_validate(p,n)!=0 || !stdscr || !curscr) return -1;
    for(i=0;i<RG_ROWS*RG_COLS;i++) stdscr->_cells[i]=(uint16_t)p[16+2*i]|(p[17+2*i]?A_STANDOUT:0);
    stdscr->_cury=(int)get16(p+10);stdscr->_curx=(int)get16(p+12);stdscr->_attrs=get16(p+14)?A_STANDOUT:0;
    memcpy(curscr->_cells,stdscr->_cells,RG_ROWS*RG_COLS*sizeof(uint16_t));
    curscr->_cury=stdscr->_cury;curscr->_curx=stdscr->_curx;
    return 0;
}
