/*
 * This file has all the code for the option command.  I would rather
 * this command were not necessary, but it is the only way to keep the
 * wolves off of my back.
 *
 * @(#)options.c	4.24 (Berkeley) 05/10/83
 *
 * Rogue: Exploring the Dungeons of Doom
 * Copyright (C) 1980-1983, 1985, 1999 Michael Toy, Ken Arnold and Glenn Wichman
 * All rights reserved.
 *
 * See the file LICENSE.TXT for full copyright and licensing information.
 */

#include <stdlib.h>
#include <curses.h>
#include <ctype.h>
#include <string.h>
#include "rogue.h"
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
#include "../contract/rogue_abi.h"

static void rg_option_value(WINDOW *win, int row, int column, const char *id, const char *english)
{
    if (win == hw)
        rg_ui_line("options", row, column, id, "[]", english);
}
#endif

#define	EQSTR(a, b, c)	(strncmp(a, b, c) == 0)

#define	NUM_OPTS	(sizeof optlist / sizeof (OPTION))

/*
 * description of an option and what to do with it
 */
struct optstruct {
    char	*o_name;	/* option name */
    char	*o_prompt;	/* prompt for interactive entry */
    void 	*o_opt;		/* pointer to thing to set */
				/* function to print value */
    void 	(*o_putfunc)(void *opt);
				/* function to get value interactively */
    int		(*o_getfunc)(void *opt, WINDOW *win);
};

typedef struct optstruct	OPTION;

void	pr_optname(OPTION *op);

OPTION	optlist[] = {
    {"terse",	 "Terse output",
		 &terse,	put_bool,	get_bool	},
    {"flush",	 "Flush typeahead during battle",
		 &fight_flush,	put_bool,	get_bool	},
    {"jump",	 "Show position only at end of run",
		 &jump,		put_bool,	get_bool	},
    {"seefloor", "Show the lamp-illuminated floor",
		 &see_floor,	put_bool,	get_sf		},
    {"passgo",	"Follow turnings in passageways",
		 &passgo,	put_bool,	get_bool	},
    {"tombstone", "Print out tombstone when killed",
		 &tombstone,	put_bool,	get_bool	},
    {"inven",	"Inventory style",
		 &inv_type,	put_inv_t,	get_inv_t	},
    {"name",	 "Name",
		 whoami,	put_str,	get_str		},
    {"fruit",	 "Fruit",
		 fruit,		put_str,	get_str		},
    {"file",	 "Save file",
		 file_name,	put_str,	get_str		}
};

/*
 * option:
 *	Print and then set options from the terminal
 */

void
option()
{
    OPTION	*op;
    int		retval;

#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    rg_ui_clear("options");
#endif
    wclear(hw);
    /*
     * Display current values of options
     */
    for (op = optlist; op <= &optlist[NUM_OPTS-1]; op++)
    {
	pr_optname(op);
	(*op->o_putfunc)(op->o_opt);
	waddch(hw, '\n');
    }
    /*
     * Set values
     */
    wmove(hw, 0, 0);
    for (op = optlist; op <= &optlist[NUM_OPTS-1]; op++)
    {
	pr_optname(op);
	retval = (*op->o_getfunc)(op->o_opt, hw);
	if (retval)
	{
	    if (retval == QUIT)
		break;
	    else if (op > optlist) {	/* MINUS */
		wmove(hw, (int)(op - optlist) - 1, 0);
		op -= 2;
	    }
	    else	/* trying to back up beyond the top */
	    {
		putchar('\007');
		wmove(hw, 0, 0);
		op--;
	    }
	}
    }
    /*
     * Switch back to original screen
     */
    wmove(hw, LINES - 1, 0);
    waddstr(hw, "--Press space to continue--");
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    rg_ui_line("options", LINES - 1, 0, "ui.continue", "[]", "--Press space to continue--");
    rg_ui_line("input", -2, 0, "input.wait_space", "[]", "");
#endif
    wrefresh(hw);
    wait_for(' ');
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    rg_ui_clear("options");
    rg_ui_clear("input");
#endif
    clearok(curscr, TRUE);
    touchwin(stdscr);
    after = FALSE;
}

/*
 * pr_optname:
 *	Print out the option name prompt
 */

void
pr_optname(OPTION *op)
{
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    static const char *const ids[] = {
        "options.terse", "options.flush", "options.jump", "options.seefloor", "options.passgo",
        "options.tombstone", "options.inven", "options.name", "options.fruit", "options.file"
    };
    int row, column;
    getyx(hw, row, column);
    rg_ui_line("options", row, column, ids[op - optlist], "[]", op->o_prompt);
#endif
    wprintw(hw, "%s (\"%s\"): ", op->o_prompt, op->o_name);
}

/*
 * put_bool
 *	Put out a boolean
 */

void
put_bool(void *b)
{
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    int row, column;
    getyx(hw, row, column);
    rg_option_value(hw, row, column, *(bool *)b ? "options.value.true" : "options.value.false",
                    *(bool *)b ? "True" : "False");
#endif
    waddstr(hw, *(bool *) b ? "True" : "False");
}

/*
 * put_str:
 *	Put out a string
 */

void
put_str(void *str)
{
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    int row, column;
    getyx(hw, row, column);
    rg_ui_printf("options", row, column, __FILE__, __LINE__, "%s", (char *)str);
#endif
    waddstr(hw, (char *) str);
}

/*
 * put_inv_t:
 *	Put out an inventory type
 */

void
put_inv_t(void *ip)
{
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    int row, column;
    static const char *const ids[] = {"options.value.overlay", "options.value.slow", "options.value.clear"};
    getyx(hw, row, column);
    rg_option_value(hw, row, column, ids[*(int *)ip], inv_t_name[*(int *)ip]);
#endif
    waddstr(hw, inv_t_name[*(int *) ip]);
}

/*
 * get_bool:
 *	Allow changing a boolean option and print it out
 */
int
get_bool(void *vp, WINDOW *win)
{
    bool *bp = (bool *) vp;
    int oy, ox;
    bool op_bad;

    op_bad = TRUE;
    getyx(win, oy, ox);
    waddstr(win, *bp ? "True" : "False");
    while (op_bad)	
    {
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
        rg_option_value(win, oy, ox, *bp ? "options.value.true" : "options.value.false", *bp ? "True" : "False");
        rg_ui_line("input", -2, 0, "input.option_bool", "[]", "");
#endif
	wmove(win, oy, ox);
	wrefresh(win);
	switch (readchar())
	{
	    case 't':
	    case 'T':
		*bp = TRUE;
		op_bad = FALSE;
		break;
	    case 'f':
	    case 'F':
		*bp = FALSE;
		op_bad = FALSE;
		break;
	    case '\n':
	    case '\r':
		op_bad = FALSE;
		break;
	    case ESCAPE:
		return QUIT;
	    case '-':
		return MINUS;
	    default:
		wmove(win, oy, ox + 10);
		waddstr(win, "(T or F)");
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
        rg_option_value(win, oy, ox + 10, "options.hint.bool", "(T or F)");
#endif
	}
    }
    wmove(win, oy, ox);
    waddstr(win, *bp ? "True" : "False");
    waddch(win, '\n');
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    rg_option_value(win, oy, ox, *bp ? "options.value.true" : "options.value.false", *bp ? "True" : "False");
    rg_ui_clear("input");
#endif
    return NORM;
}

/*
 * get_sf:
 *	Change value and handle transition problems from see_floor to
 *	!see_floor.
 */
int
get_sf(void *vp, WINDOW *win)
{
    bool	*bp = (bool *) vp;
    bool	was_sf;
    int		retval;

    was_sf = see_floor;
    retval = get_bool(bp, win);
    if (retval == QUIT) return(QUIT);
    if (was_sf != see_floor)
    {
	if (!see_floor) {
	    see_floor = TRUE;
	    erase_lamp(&hero, proom);
	    see_floor = FALSE;
	}
	else
	    look(FALSE);
    }
    return(NORM);
}

/*
 * get_str:
 *	Set a string option
 */
#define MAXINP	50	/* max string to read from terminal or environment */

int
get_str(void *vopt, WINDOW *win)
{
    char *opt = (char *) vopt;
    char *sp;
    int oy, ox;
    int i;
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
    int c;
#else
    signed char c;
#endif
    static char buf[MAXSTR];

    getyx(win, oy, ox);
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
    buf[0] = '\0';
    rg_host_text_mode(opt == whoami ? 2 : opt == fruit ? 3 : 1, MAXINP, opt);
#endif
    wrefresh(win);
    /*
     * loop reading in the string, and put it in a temporary buffer
     */
    for (sp = buf; (c =
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
        (unsigned char)
#endif
        readchar()) != '\n' && c != '\r' && c != ESCAPE;
	wclrtoeol(win), wrefresh(win))
    {
	if (c == -1
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
        || c == 255
#endif
        )
	    continue;
	else if (c == erasechar())	/* process erase character */
	{
	    if (sp > buf)
	    {
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
        char *end = sp;
        do { --sp; } while (sp > buf && ((unsigned char)*sp & 0xc0) == 0x80);
        i = (unsigned char)*sp >= 128 ? (int)(end - sp) : (int)strlen(unctrl(*sp));
#else
		sp--;
        i = (int) strlen(unctrl(*sp));
#endif
		for (; i; i--)
		    waddch(win, '\b');
	    }
	    continue;
	}
	else if (c == killchar())	/* process kill character */
	{
	    sp = buf;
	    wmove(win, oy, ox);
	    continue;
	}
	else if (sp == buf)
	{
	    if (c == '-' && win != stdscr)
		break;
	    else if (c == '~')
	    {
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
        strucpy(buf, home, (int)strlen(home));
#else
		strcpy(buf, home);
#endif
		waddstr(win, buf);
		sp += strlen(buf);
		continue;
	    }
	}
	if (sp >= &buf[MAXINP] || !(isprint((unsigned char)c) || c == ' '
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
        || (c >= 128 && c <= 255)
#endif
        ))
	    putchar(CTRL('G'));
	else
	{
	    *sp++ = c;
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
        if (c >= 128) {
            char byte[2] = {(char)c, '\0'};
            waddstr(win, byte);
        } else
#endif
	    waddstr(win, unctrl(c));
	}
    }
    *sp = '\0';
    if (sp > buf)	/* only change option if something has been typed */
	strucpy(opt, buf, (int) strlen(buf));
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
    rg_host_text_mode(0, 0, opt);
    if (opt == whoami) rg_host_player_name(whoami);
    if (win == hw) rg_ui_printf("options", oy, ox, __FILE__, __LINE__, "%s", opt);
#endif
    mvwprintw(win, oy, ox, "%s\n", opt);
    wrefresh(win);
    if (win == stdscr)
	mpos += (int)(sp - buf);
    if (c == '-')
	return MINUS;
    else if (c == ESCAPE)
	return QUIT;
    else
	return NORM;
}

/*
 * get_inv_t
 *	Get an inventory type name
 */
int
get_inv_t(void *vp, WINDOW *win)
{
    int *ip = (int *) vp;
    int oy, ox;
    bool op_bad;

    op_bad = TRUE;
    getyx(win, oy, ox);
    waddstr(win, inv_t_name[*ip]);
    while (op_bad)	
    {
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
        static const char *const ids[] = {"options.value.overlay", "options.value.slow", "options.value.clear"};
        rg_option_value(win, oy, ox, ids[*ip], inv_t_name[*ip]);
        rg_ui_line("input", -2, 0, "input.option_inventory", "[]", "");
#endif
	wmove(win, oy, ox);
	wrefresh(win);
	switch (readchar())
	{
	    case 'o':
	    case 'O':
		*ip = INV_OVER;
		op_bad = FALSE;
		break;
	    case 's':
	    case 'S':
		*ip = INV_SLOW;
		op_bad = FALSE;
		break;
	    case 'c':
	    case 'C':
		*ip = INV_CLEAR;
		op_bad = FALSE;
		break;
	    case '\n':
	    case '\r':
		op_bad = FALSE;
		break;
	    case ESCAPE:
		return QUIT;
	    case '-':
		return MINUS;
	    default:
		wmove(win, oy, ox + 15);
		waddstr(win, "(O, S, or C)");
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
        rg_option_value(win, oy, ox + 15, "options.hint.inventory", "(O, S, or C)");
#endif
	}
    }
    mvwprintw(win, oy, ox, "%s\n", inv_t_name[*ip]);
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    {
        static const char *const ids[] = {"options.value.overlay", "options.value.slow", "options.value.clear"};
        rg_option_value(win, oy, ox, ids[*ip], inv_t_name[*ip]);
        rg_ui_clear("input");
    }
#endif
    return NORM;
}
	

#ifdef MASTER
/*
 * get_num:
 *	Get a numeric option
 */
int
get_num(void *vp, WINDOW *win)
{
    short *opt = (short *) vp;
    int i;
    static char buf[MAXSTR];

    if ((i = get_str(buf, win)) == NORM)
	*opt = (short) atoi(buf);
    return i;
}
#endif

/*
 * parse_opts:
 *	Parse options from string, usually taken from the environment.
 *	The string is a series of comma seperated values, with booleans
 *	being stated as "name" (true) or "noname" (false), and strings
 *	being "name=....", with the string being defined up to a comma
 *	or the end of the entire option string.
 */

void
parse_opts(char *str)
{
    char *sp;
    OPTION *op;
    int len;
    char **i;
    char *start;

    while (*str)
    {
	/*
	 * Get option name
	 */
	for (sp = str; isalpha((unsigned char)*sp); sp++)
	    continue;
	len = (int)(sp - str);
	/*
	 * Look it up and deal with it
	 */
	for (op = optlist; op <= &optlist[NUM_OPTS-1]; op++)
	    if (EQSTR(str, op->o_name, len))
	    {
		if (op->o_putfunc == put_bool)	/* if option is a boolean */
		    *(bool *)op->o_opt = TRUE;	/* NOSTRICT */
		else				/* string option */
		{
		    /*
		     * Skip to start of string value
		     */
		    for (str = sp + 1; *str == '='; str++)
			continue;
		    if (*str == '~')
		    {
			strcpy((char *) op->o_opt, home);	  /* NOSTRICT */
			start = (char *) op->o_opt + strlen(home);/* NOSTRICT */
			while (*++str == '/')
			    continue;
		    }
		    else
			start = (char *) op->o_opt;	/* NOSTRICT */
		    /*
		     * Skip to end of string value
		     */
		    for (sp = str + 1; *sp && *sp != ','; sp++)
			continue;
		    /*
		     * check for type of inventory
		     */
		    if (op->o_putfunc == put_inv_t)
		    {
			if (islower((unsigned char)*str))
			    *str = (char) toupper((unsigned char)*str);
			for (i = inv_t_name; i <= &inv_t_name[INV_CLEAR]; i++)
			    if (strncmp(str, *i, sp - str) == 0)
			    {
				inv_type = (int)(i - inv_t_name);
				break;
			    }
		    }
		    else
			strucpy(start, str, (int)(sp - str));
		}
		break;
	    }
	    /*
	     * check for "noname" for booleans
	     */
	    else if (op->o_putfunc == put_bool
	      && EQSTR(str, "no", 2) && EQSTR(str + 2, op->o_name, len - 2))
	    {
		*(bool *)op->o_opt = FALSE;	/* NOSTRICT */
		break;
	    }

	/*
	 * skip to start of next option name
	 */
	while (*sp && !isalpha((unsigned char)*sp))
	    sp++;
	str = sp;
    }
}

/*
 * strucpy:
 *	Copy string using unctrl for things
 */

#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
/* Return a complete Unicode scalar's byte length; reject overlong encodings,
 * surrogate halves and values outside Unicode. Never read beyond len. */
static int rg_utf8_size(const unsigned char *text, int len)
{
    unsigned char a;
    int size, i;
    if (len < 1) return 0;
    a = text[0];
    size = a < 0x80 ? 1 : a >= 0xc2 && a <= 0xdf ? 2 :
        a >= 0xe0 && a <= 0xef ? 3 : a >= 0xf0 && a <= 0xf4 ? 4 : 0;
    if (!size || size > len) return 0;
    for (i = 1; i < size; ++i) if ((text[i] & 0xc0) != 0x80) return 0;
    if ((a == 0xe0 && text[1] < 0xa0) || (a == 0xed && text[1] >= 0xa0) ||
        (a == 0xf0 && text[1] < 0x90) || (a == 0xf4 && text[1] >= 0x90)) return 0;
    return size;
}
#endif

void
strucpy(char *s1, char *s2, int len)
{
    if (len > MAXINP)
	len = MAXINP;
#ifdef ROGUE_LAYERED /* RG_UTF8_TEXT */
    while (len > 0) {
        unsigned char byte = (unsigned char)*s2;
        int size = rg_utf8_size((const unsigned char *)s2, len), i;
        if (!size) { ++s2; --len; continue; }
        if (size > 1 || isprint(byte) || byte == ' ')
            for (i = 0; i < size; ++i) *s1++ = s2[i];
        s2 += size;
        len -= size;
    }
#else
    while (len--)
    {
	if (isprint((unsigned char)*s2) || *s2 == ' ')
	    *s1++ = *s2;
	s2++;
    }
#endif
    *s1 = '\0';
}
