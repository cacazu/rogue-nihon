/*
 * File for the fun ends
 * Death or a total win
 *
 * @(#)rip.c	4.57 (Berkeley) 02/05/99
 *
 * Rogue: Exploring the Dungeons of Doom
 * Copyright (C) 1980-1983, 1985, 1999 Michael Toy, Ken Arnold and Glenn Wichman
 * All rights reserved.
 *
 * See the file LICENSE.TXT for full copyright and licensing information.
 */

#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <signal.h>
#include <sys/types.h>
#include <ctype.h>
#include <fcntl.h>
#include <curses.h>
#include "rogue.h"
#include "semantic.h"
#include "score.h"

/* Localized overlays observe exactly the values chosen by the original end
 * screen. The ASCII knowledge buffer, score rules and RNG calls are untouched. */
static void
rg_ending_line(const char *scope, int row, int column, const char *id,
               const char *format, ...)
{
    char arguments[RG_MESSAGE_ARGUMENT_BYTES], english[2048];
    va_list original, capture, render;
    va_start(original, format);
    va_copy(capture, original);
    if (rg_message_arguments(format, capture, arguments, sizeof arguments) != 0)
    {
        strcpy(arguments, "[]");
        id = "ui.untranslated";
    }
    va_end(capture);
    va_copy(render, original);
    if (vsnprintf(english, sizeof english, format, render) < 0)
        english[0] = '\0';
    va_end(render);
    va_end(original);
    rg_ui_line(scope, row, column, id, arguments, english);
}

static char *rip[] = {
"                       __________\n",
"                      /          \\\n",
"                     /    REST    \\\n",
"                    /      IN      \\\n",
"                   /     PEACE      \\\n",
"                  /                  \\\n",
"                  |                  |\n",
"                  |                  |\n",
"                  |   killed by a    |\n",
"                  |                  |\n",
"                  |       1980       |\n",
"                 *|     *  *  *      | *\n",
"         ________)/\\\\_//(\\/(/\\)/\\//\\/|_)_______\n",
    0
};

/*
 * score:
 *	Figure score and post it.
 */
/* VARARGS2 */

void
score(int amount, int flags, char monst)
{
    SCORE *scp;
    int i;
    SCORE *sc2;
    SCORE *top_ten, *endp;
# ifdef MASTER
    int prflags = 0;
# endif
    void (*fp)(int);
    unsigned int uid;
    static char *reason[] = {
	"killed",
	"quit",
	"A total winner",
	"killed with Amulet"
    };

    start_score();
    rg_ui_clear("score");

 if (flags >= 0
#ifdef MASTER
            || wizard
#endif
        )
    {
	mvaddstr(LINES - 1, 0 , "[Press return to continue]");
        rg_ui_line("score", LINES - 1, 0, "ui.ending.return", "[]",
            "[Press return to continue]");
        refresh();
        rg_ui_line("input", -2, 0, "input.show_score", "[]", "");
        wgetnstr(stdscr,prbuf,80);
        rg_ui_clear("input");
 	endwin();
        printf("\n");
        resetltchars();
	/*
	 * free up space to "guarantee" there is space for the top_ten
	 */
	delwin(stdscr);
	delwin(curscr);
	if (hw != NULL)
	    delwin(hw);
    }

    top_ten = (SCORE *) malloc(numscores * sizeof (SCORE));
    endp = &top_ten[numscores];
    for (scp = top_ten; scp < endp; scp++)
    {
	scp->sc_score = 0;
	for (i = 0; i < MAXSTR; i++)
	    scp->sc_name[i] = (unsigned char) rnd(255);
	scp->sc_flags = RN;
	scp->sc_level = RN;
	scp->sc_monster = (unsigned short) RN;
	scp->sc_uid = RN;
    }

    signal(SIGINT, SIG_DFL);

#ifdef MASTER
    if (wizard)
	if (strcmp(prbuf, "names") == 0)
	    prflags = 1;
	else if (strcmp(prbuf, "edit") == 0)
	    prflags = 2;
#endif
    rd_score(top_ten);
    /*
     * Insert her in list if need be
     */
    sc2 = NULL;
    if (!noscore)
    {
	uid = md_getuid();
	for (scp = top_ten; scp < endp; scp++)
	    if (amount > scp->sc_score)
		break;
	    else if (!allscore &&	/* only one score per nowin uid */
		flags != 2 && scp->sc_uid == uid && scp->sc_flags != 2)
		    scp = endp;
	if (scp < endp)
	{
	    if (flags != 2 && !allscore)
	    {
		for (sc2 = scp; sc2 < endp; sc2++)
		{
		    if (sc2->sc_uid == uid && sc2->sc_flags != 2)
			break;
		}
		if (sc2 >= endp)
		    sc2 = endp - 1;
	    }
	    else
		sc2 = endp - 1;
	    while (sc2 > scp)
	    {
		*sc2 = sc2[-1];
		sc2--;
	    }
	    scp->sc_score = amount;
	    strncpy(scp->sc_name, whoami, MAXSTR);
	    scp->sc_flags = flags;
	    if (flags == 2)
		scp->sc_level = max_level;
	    else
		scp->sc_level = level;
	    scp->sc_monster = monst;
	    scp->sc_uid = uid;
	    sc2 = scp;
	}
    }
    /*
     * Print the list
     */
    if (flags != -1)
	putchar('\n');
    printf("Top %s %s:\n", Numname, allscore ? "Scores" : "Rogueists");
    printf("   Score Name\n");
    rg_ending_line("score", 0, 0, "ui.score.heading", "Top %s %s:",
        Numname, allscore ? "Scores" : "Rogueists");
    rg_ui_line("score", 1, 0, "ui.score.columns", "[]", "   Score Name");
    /* Keep an ending scope alive throughout the transition so intermediate
     * frames never interpret the ASCII valuation as a dungeon map. */
    rg_ui_clear("victory");
    rg_ui_clear("death");
    rg_ui_clear("tombstone");
    for (scp = top_ten; scp < endp; scp++)
    {
	if (scp->sc_score) {

        if (sc2 == scp) rg_semantic_copy(scp->sc_name, whoami);
        switch (scp->sc_flags)
        {
            case 0: rg_semantic_register_term(reason[0], "ui.score.reason.killed"); break;
            case 1: rg_semantic_register_term(reason[1], "ui.score.reason.quit"); break;
            case 2: rg_semantic_register_term(reason[2], "ui.score.reason.winner"); break;
            case 3: rg_semantic_register_term(reason[3], "ui.score.reason.amulet"); break;
        }
    if (sc2 == scp)
            md_raw_standout();
	    printf("%2d %5d %s: %s on level %d", (int) (scp - top_ten + 1),
		scp->sc_score, scp->sc_name, reason[scp->sc_flags],
		scp->sc_level);
	    if (scp->sc_flags == 0 || scp->sc_flags == 3)
            {
                /* Observe the one original killname result; never invoke the
                 * formatter again or alter its shared prbuf lifetime. */
                char *score_killer = killname((char) scp->sc_monster, TRUE);
                printf(" by %s", score_killer);
                rg_ending_line("score", (int)(scp - top_ten) + 2, 0,
                    "ui.score.entry_death", "%2d %5d %s: %s on level %d by %s",
                    (int)(scp-top_ten+1), scp->sc_score, scp->sc_name,
                    reason[scp->sc_flags], scp->sc_level, score_killer);
            }
            else
                rg_ending_line("score", (int)(scp - top_ten) + 2, 0,
                    "ui.score.entry", "%2d %5d %s: %s on level %d",
                    (int)(scp-top_ten+1), scp->sc_score, scp->sc_name,
                    reason[scp->sc_flags], scp->sc_level);
#ifdef MASTER
	    if (prflags == 1)
	    {
	    printf(" (%s)", md_getrealname(scp->sc_uid));
	    }
	    else if (prflags == 2)
	    {
		fflush(stdout);
		(void) fgets(prbuf,10,stdin);
		if (prbuf[0] == 'd')
		{
		    for (sc2 = scp; sc2 < endp - 1; sc2++)
			*sc2 = *(sc2 + 1);
		    sc2 = endp - 1;
		    sc2->sc_score = 0;
		    for (i = 0; i < MAXSTR; i++)
			sc2->sc_name[i] = (char) rnd(255);
		    sc2->sc_flags = RN;
		    sc2->sc_level = RN;
		    sc2->sc_monster = (unsigned short) RN;
		    scp--;
		}
	    }
	    else
#endif /* MASTER */
                printf(".");
	    if (sc2 == scp)
            md_raw_standend();
            putchar('\n');
	}
	else
	    break;
    }
    /*
     * Update the list file
     */
    if (sc2 != NULL)
    {
	if (lock_sc())
	{
	    fp = signal(SIGINT, SIG_IGN);
	    wr_score(top_ten);
	    unlock_sc();
	    signal(SIGINT, fp);
	}
    }
}

/*
 * death:
 *	Do something really fun when he dies
 */

void
death(char monst)
{
#ifdef ROGUE_LAYERED
    rg_core_set_outcome(1, "dead");
#endif
    char **dp, *killer;
    struct tm *lt;
    static time_t date;
#ifndef ROGUE_LAYERED
    struct tm *localtime();
#endif

    signal(SIGINT, SIG_IGN);
    purse -= purse / 10;
#ifdef ROGUE_LAYERED
    rg_status_publish(0);
#endif
    signal(SIGINT, leave);
    clear();
    rg_ui_clear("death");
    rg_ui_clear("tombstone");
    killer = killname(monst, FALSE);
    if (!tombstone)
    {
	mvprintw(LINES - 2, 0, "Killed by ");
	killer = killname(monst, FALSE);
	if (monst != 's' && monst != 'h')
	    printw("a%s ", vowelstr(killer));
	printw("%s with %d gold", killer, purse);
        rg_ending_line("death", LINES - 2, 0, "ui.ending.death_summary",
            "Killed by %s%s with %d gold",
            (monst=='s'||monst=='h') ? "" :
                (strchr("aAeEiIoOuU", killer[0]) ? "an " : "a "),
            killer, purse);
    }
    else
    {
	time(&date);
	lt = localtime(&date);
	move(8, 0);
	dp = rip;
	while (*dp)
	    addstr(*dp++);
	mvaddstr(17, center(killer), killer);
        rg_ending_line("tombstone", 17, center(killer), "ui.ending.cause", "%s", killer);
	if (monst == 's' || monst == 'h')
	    mvaddch(16, 32, ' ');
	else
	    mvaddstr(16, 33, vowelstr(killer));
	mvaddstr(14, center(whoami), whoami);
        rg_ending_line("tombstone", 14, center(whoami), "ui.ending.name", "%s", whoami);
	sprintf(prbuf, "%d Au", purse);
	move(15, center(prbuf));
	addstr(prbuf);
        rg_ending_line("tombstone", 15, center(prbuf), "ui.ending.gold", "%d Au", purse);
	sprintf(prbuf, "%4d", 1900+lt->tm_year);
	mvaddstr(18, 26, prbuf);
        rg_ending_line("tombstone", 18, 26, "ui.ending.year", "%4d", 1900+lt->tm_year);
        rg_ui_line("tombstone", 10, 26, "ui.ending.rest", "[]", "REST");
        rg_ui_line("tombstone", 11, 27, "ui.ending.in", "[]", "IN");
        rg_ui_line("tombstone", 12, 25, "ui.ending.peace", "[]", "PEACE");
        rg_ui_line("tombstone", 16, 22, "ui.ending.killed_by", "[]", "killed by a");
    }
    move(LINES - 1, 0);
    refresh();
    score(purse, amulet ? 3 : 0, monst);
    printf("[Press return to continue]");
    rg_ui_line("death", LINES - 1, 0, "ui.ending.return", "[]",
        "[Press return to continue]");
    fflush(stdout);
    rg_ui_line("input", -2, 0, "input.finish_game", "[]", "");
    (void) fgets(prbuf,10,stdin);
    rg_ui_clear("input");
    my_exit(0);
}

/*
 * center:
 *	Return the index to center the given string
 */
int
center(char *str)
{
    return 28 - (((int)strlen(str) + 1) / 2);
}

/*
 * total_winner:
 *	Code for a winner
 */

void
total_winner()
{
#ifdef ROGUE_LAYERED
    rg_core_set_outcome(2, "winner");
#endif
    THING *obj;
    struct obj_info *op;
    int worth = 0;
    int oldpurse;

    clear();
    rg_ui_clear("victory");
    standout();
    addstr("                                                               \n");
    addstr("  @   @               @   @           @          @@@  @     @  \n");
    addstr("  @   @               @@ @@           @           @   @     @  \n");
    addstr("  @   @  @@@  @   @   @ @ @  @@@   @@@@  @@@      @  @@@    @  \n");
    addstr("   @@@@ @   @ @   @   @   @     @ @   @ @   @     @   @     @  \n");
    addstr("      @ @   @ @   @   @   @  @@@@ @   @ @@@@@     @   @     @  \n");
    addstr("  @   @ @   @ @  @@   @   @ @   @ @   @ @         @   @  @     \n");
    addstr("   @@@   @@@   @@ @   @   @  @@@@  @@@@  @@@     @@@   @@   @  \n");
    addstr("                                                               \n");
    addstr("     Congratulations, you have made it to the light of day!    \n");
    standend();
    addstr("\nYou have joined the elite ranks of those who have escaped the\n");
    addstr("Dungeons of Doom alive.  You journey home and sell all your loot at\n");
    addstr("a great profit and are admitted to the Fighters' Guild.\n");
    rg_ui_line("victory", 3, 0, "ui.ending.victory_title", "[]", "YOU MADE IT!");
    rg_ui_line("victory", 8, 5, "ui.ending.congratulations", "[]",
        "Congratulations, you have made it to the light of day!");
    rg_ui_line("victory", 10, 0, "ui.ending.elite", "[]",
        "You have joined the elite ranks of those who have escaped the");
    rg_ui_line("victory", 11, 0, "ui.ending.home", "[]",
        "Dungeons of Doom alive.  You journey home and sell all your loot at");
    rg_ui_line("victory", 12, 0, "ui.ending.guild", "[]",
        "a great profit and are admitted to the Fighters' Guild.");
    mvaddstr(LINES - 1, 0, "--Press space to continue--");
    rg_ui_line("victory", LINES - 1, 0, "ui.ending.space", "[]",
        "--Press space to continue--");
    refresh();
    rg_wait_for(' ', "input.results");
    clear();
    rg_ui_clear("victory");
    mvaddstr(0, 0, "   Worth  Item\n");
    rg_ui_line("victory", 0, 0, "ui.ending.loot_columns", "[]", "   Worth  Item");
    oldpurse = purse;
    for (obj = pack; obj != NULL; obj = next(obj))
    {
	switch (obj->o_type)
	{
	    case FOOD:
		worth = 2 * obj->o_count;
	    when WEAPON:
		worth = weap_info[obj->o_which].oi_worth;
		worth *= 3 * (obj->o_hplus + obj->o_dplus) + obj->o_count;
		obj->o_flags |= ISKNOW;
	    when ARMOR:
		worth = arm_info[obj->o_which].oi_worth;
		worth += (9 - obj->o_arm) * 100;
		worth += (10 * (a_class[obj->o_which] - obj->o_arm));
		obj->o_flags |= ISKNOW;
	    when SCROLL:
		worth = scr_info[obj->o_which].oi_worth;
		worth *= obj->o_count;
		op = &scr_info[obj->o_which];
		if (!op->oi_know)
		    worth /= 2;
		op->oi_know = TRUE;
	    when POTION:
		worth = pot_info[obj->o_which].oi_worth;
		worth *= obj->o_count;
		op = &pot_info[obj->o_which];
		if (!op->oi_know)
		    worth /= 2;
		op->oi_know = TRUE;
	    when RING:
		op = &ring_info[obj->o_which];
		worth = op->oi_worth;
		if (obj->o_which == R_ADDSTR || obj->o_which == R_ADDDAM ||
		    obj->o_which == R_PROTECT || obj->o_which == R_ADDHIT)
		{
			if (obj->o_arm > 0)
			    worth += obj->o_arm * 100;
			else
			    worth = 10;
		}
		if (!(obj->o_flags & ISKNOW))
		    worth /= 2;
		obj->o_flags |= ISKNOW;
		op->oi_know = TRUE;
	    when STICK:
		op = &ws_info[obj->o_which];
		worth = op->oi_worth;
		worth += 20 * obj->o_charges;
		if (!(obj->o_flags & ISKNOW))
		    worth /= 2;
		obj->o_flags |= ISKNOW;
		op->oi_know = TRUE;
	    when AMULET:
		worth = 1000;
	}
	if (worth < 0)
	    worth = 0;
	printw("%c) %5d  %s\n", obj->o_packch, worth, inv_name(obj, FALSE));
        {
            int row=1;
            THING *previous;
            char selection[2]={obj->o_packch, '\0'};
            /* Count only already visited list nodes; do not call inv_name a
             * second time or modify the player's now-identified equipment. */
            for(previous=pack; previous!=obj; previous=next(previous)) row++;
            rg_ending_line("victory", row, 0, "ui.ending.loot_item",
                "%s) %5d  %s", selection, worth, prbuf);
        }
	purse += worth;
    }
    printw("   %5d  Gold Pieces          ", oldpurse);
    {
        int row=1; THING *previous;
        for(previous=pack;previous;previous=next(previous))row++;
        rg_ending_line("victory", row, 0, "ui.ending.gold_value", "   %5d  Gold Pieces", oldpurse);
    }
    refresh();
    score(purse, 2, ' ');
    my_exit(0);
}

/*
 * killname:
 *	Convert a code to a monster name
 */
char *
killname(char monst, bool doart)
{
    struct h_list *hp;
    char *sp;
    bool article;
    static struct h_list nlist[] = {
	{'a',	"arrow",		TRUE},
	{'b',	"bolt",			TRUE},
	{'d',	"dart",			TRUE},
	{'h',	"hypothermia",		FALSE},
	{'s',	"starvation",		FALSE},
	{'\0'}
    };

    if (isupper(monst))
    {
	sp = monsters[monst-'A'].m_name;
	article = TRUE;
    }
    else
    {
	sp = "Wally the Wonder Badger";
	article = FALSE;
	for (hp = nlist; hp->h_ch; hp++)
	    if (hp->h_ch == monst)
	    {
		sp = hp->h_desc;
		article = hp->h_print;
		break;
	    }
    }
    if (doart && article)
	sprintf(prbuf, "a%s ", vowelstr(sp));
    else
	prbuf[0] = '\0';
    strcat(prbuf, sp);
    rg_semantic_death(prbuf, (unsigned char)monst, doart && article);
    return prbuf;
}

/*
 * death_monst:
 *	Return a monster appropriate for a random death.
 */
char
death_monst()
{
    static char poss[] =
    {
	'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L',
	'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X',
	'Y', 'Z', 'a', 'b', 'h', 'd', 's',
	' '	/* This is provided to generate the "Wally the Wonder Badger"
		   message for killer */
    };

    return poss[rnd(sizeof poss / sizeof (char))];
}
