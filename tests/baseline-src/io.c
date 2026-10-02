/*
 * Various input/output functions
 *
 * @(#)io.c	4.32 (Berkeley) 02/05/99
 */

#include <stdarg.h>
#include <curses.h>
#include <ctype.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include "rogue.h"
#include "io_state.h"
#include "rogue_abi.h"

/*
 * msg:
 *	Display a message at the top of the screen.
 */
#define MAXMSG	(NUMCOLS - sizeof "--More--")

static char msgbuf[2*MAXMSG+1];
static int newpos = 0;

/* VARARGS1 */
int
msg(char *fmt, ...)
{
    va_list args;

    /*
     * if the string is "", just clear the line
     */
    if (*fmt == '\0')
    {
	move(0, 0);
	clrtoeol();
	mpos = 0;
	rg_host_message("message.clear", "[]", "");
	return ~ESCAPE;
    }
    /*
     * otherwise add to the message and flush it out
     */
    va_start(args, fmt);
    doadd(fmt, args);
    va_end(args);
    return endmsg();
}

/*
 * addmsg:
 *	Add things to the current message
 */
/* VARARGS1 */
void
addmsg(char *fmt, ...)
{
    va_list args;

    va_start(args, fmt);
    doadd(fmt, args);
    va_end(args);
}

/*
 * endmsg:
 *	Display a new msg (giving him a chance to see the previous one
 *	if it is up there with the --More--)
 */
int
endmsg()
{
    char ch;

    if (save_msg)
	strcpy(huh, msgbuf);
    if (mpos)
    {
	look(FALSE);
	mvaddstr(0, mpos, "--More--");
	refresh();
	if (!msg_esc)
	    wait_for(' ');
	else
	{
	    while ((ch = readchar()) != ' ')
		if (ch == ESCAPE)
		{
		    msgbuf[0] = '\0';
		    mpos = 0;
		    newpos = 0;
		    msgbuf[0] = '\0';
		    return ESCAPE;
		}
	}
    }
    /*
     * All messages should start with uppercase, except ones that
     * start with a pack addressing character
     */
    if (islower(msgbuf[0]) && !lower_msg && msgbuf[1] != ')')
	msgbuf[0] = (char) toupper(msgbuf[0]);
    mvaddstr(0, 0, msgbuf);
    clrtoeol();
    rg_host_message("message.legacy", "[]", msgbuf);
    mpos = newpos;
    newpos = 0;
    msgbuf[0] = '\0';
    refresh();
    return ~ESCAPE;
}

/*
 * doadd:
 *	Perform an add onto the message buffer
 */
void
doadd(char *fmt, va_list args)
{
    static char buf[MAXSTR];

    /*
     * Do the printf into buf
     */
    vsprintf(buf, fmt, args);
    if (strlen(buf) + newpos >= MAXMSG)
        endmsg(); 
    strcat(msgbuf, buf);
    newpos = (int) strlen(msgbuf);
}

/* Private logical paging state affects --More--, look(FALSE), and therefore
 * the RNG. The global mpos is serialized by state.c; this section owns only
 * msgbuf/newpos. Presentation metadata is transient and may fall back to
 * legacy English if a checkpoint contains a partially accumulated message. */
#define RG_MESSAGE_STATE_BYTES (8u + (uint32_t)sizeof msgbuf)

static uint32_t rg_io_read_u32(const uint8_t *bytes)
{
    return (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8)
        | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
}

static void rg_io_write_u32(uint8_t *bytes, uint32_t value)
{
    bytes[0] = (uint8_t)value;
    bytes[1] = (uint8_t)(value >> 8);
    bytes[2] = (uint8_t)(value >> 16);
    bytes[3] = (uint8_t)(value >> 24);
}

int rg_message_state_export(uint8_t **out, uint32_t *length)
{
    uint8_t *bytes;
    if (!out || !length) return -1;
    *out = NULL;
    *length = 0;
    bytes = (uint8_t *)malloc(RG_MESSAGE_STATE_BYTES);
    if (!bytes) return -1;
    rg_io_write_u32(bytes, 1);
    rg_io_write_u32(bytes + 4, (uint32_t)newpos);
    memcpy(bytes + 8, msgbuf, sizeof msgbuf);
    *out = bytes;
    *length = RG_MESSAGE_STATE_BYTES;
    return 0;
}

int rg_message_state_validate(const uint8_t *bytes, uint32_t length)
{
    const uint8_t *terminator;
    uint32_t position;
    if (!bytes || length != RG_MESSAGE_STATE_BYTES || rg_io_read_u32(bytes) != 1)
        return -1;
    position = rg_io_read_u32(bytes + 4);
    if (position >= sizeof msgbuf) return -1;
    terminator = (const uint8_t *)memchr(bytes + 8, '\0', sizeof msgbuf);
    if (!terminator || (uint32_t)(terminator - (bytes + 8)) != position) return -1;
    return 0;
}

int rg_message_state_import(const uint8_t *bytes, uint32_t length)
{
    if (rg_message_state_validate(bytes, length) != 0) return -1;
    newpos = (int)rg_io_read_u32(bytes + 4);
    memcpy(msgbuf, bytes + 8, sizeof msgbuf);
    return 0;
}

/*
 * step_ok:
 *	Returns true if it is ok to step on ch
 */
int
step_ok(int ch)
{
    switch (ch)
    {
	case ' ':
	case '|':
	case '-':
	    return FALSE;
	default:
	    return (!isalpha(ch));
    }
}

/*
 * readchar:
 *	Reads and returns a character, checking for gross input errors
 */
char
readchar()
{
    char ch;

    ch = (char) md_readchar();

    if (ch == 3)
    {
	quit(0);
        return(27);
    }

    return(ch);
}

/*
 * status:
 *	Display the important stats line.  Keep the cursor where it was.
 */
static int hpwidth = 0;
static int s_hungry = 0;
static int s_lvl = 0;
static int s_pur = -1;
static int s_hp = 0;
static int s_arm = 0;
static str_t s_str = 0;
static int s_exp = 0;

void
status()
{
    register int oy, ox, temp;
    static char *state_name[] =
    {
	"", "Hungry", "Weak", "Faint"
    };

    /*
     * If nothing has changed since the last status, don't
     * bother.
     */
    temp = (cur_armor != NULL ? cur_armor->o_arm : pstats.s_arm);
    if (s_hp == pstats.s_hpt && s_exp == pstats.s_exp && s_pur == purse
	&& s_arm == temp && s_str == pstats.s_str && s_lvl == level
	&& s_hungry == hungry_state
	&& !stat_msg
	)
	    return;

    s_arm = temp;

    getyx(stdscr, oy, ox);
    if (s_hp != max_hp)
    {
	temp = max_hp;
	s_hp = max_hp;
	for (hpwidth = 0; temp; hpwidth++)
	    temp /= 10;
    }

    /*
     * Save current status
     */
    s_lvl = level;
    s_pur = purse;
    s_hp = pstats.s_hpt;
    s_str = pstats.s_str;
    s_exp = pstats.s_exp; 
    s_hungry = hungry_state;

    if (stat_msg)
    {
	move(0, 0);
        msg("Level: %d  Gold: %-5d  Hp: %*d(%*d)  Str: %2d(%d)  Arm: %-2d  Exp: %d/%ld  %s",
	    level, purse, hpwidth, pstats.s_hpt, hpwidth, max_hp, pstats.s_str,
	    max_stats.s_str, 10 - s_arm, pstats.s_lvl, pstats.s_exp,
	    state_name[hungry_state]);
    }
    else
    {
	move(STATLINE, 0);
                
        printw("Level: %d  Gold: %-5d  Hp: %*d(%*d)  Str: %2d(%d)  Arm: %-2d  Exp: %d/%d  %s",
	    level, purse, hpwidth, pstats.s_hpt, hpwidth, max_hp, pstats.s_str,
	    max_stats.s_str, 10 - s_arm, pstats.s_lvl, pstats.s_exp,
	    state_name[hungry_state]);
    }

    clrtoeol();
    move(oy, ox);
}

#ifdef ROGUE_LAYERED
void rg_status_state_get(uint32_t *out) {
    out[0]=(uint32_t)hpwidth;out[1]=(uint32_t)s_hungry;out[2]=(uint32_t)s_lvl;out[3]=(uint32_t)s_pur;
    out[4]=(uint32_t)s_hp;out[5]=(uint32_t)s_arm;out[6]=(uint32_t)s_str;out[7]=(uint32_t)s_exp;
}
void rg_status_state_set(const uint32_t *in) {
    hpwidth=(int32_t)in[0];s_hungry=(int32_t)in[1];s_lvl=(int32_t)in[2];s_pur=(int32_t)in[3];
    s_hp=(int32_t)in[4];s_arm=(int32_t)in[5];s_str=(str_t)in[6];s_exp=(int32_t)in[7];
}
#endif

/*
 * wait_for
 *	Sit around until the guy types the right key
 */
void
wait_for(int ch)
{
    register char c;

    if (ch == '\n')
        while ((c = readchar()) != '\n' && c != '\r')
	    continue;
    else
        while (readchar() != ch)
	    continue;
}

/*
 * show_win:
 *	Function used to display a window and wait before returning
 */
void
show_win(char *message)
{
    WINDOW *win;

    win = hw;
    wmove(win, 0, 0);
    waddstr(win, message);
    touchwin(win);
    wmove(win, hero.y, hero.x);
    wrefresh(win);
    wait_for(' ');
    clearok(curscr, TRUE);
    touchwin(stdscr);
}
