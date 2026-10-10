/*
 * Routines to deal with the pack
 *
 * @(#)pack.c	4.40 (Berkeley) 02/05/99
 *
 * Rogue: Exploring the Dungeons of Doom
 * Copyright (C) 1980-1983, 1985, 1999 Michael Toy, Ken Arnold and Glenn Wichman
 * All rights reserved.
 *
 * See the file LICENSE.TXT for full copyright and licensing information.
 */

#include <string.h>
#include <curses.h>
#include <ctype.h>
#include "rogue.h"
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
#include "semantic.h"
#endif

/*
 * add_pack:
 *	Pick up an object and add it to the pack.  If the argument is
 *	non-null use it as the linked_list pointer instead of gettting
 *	it off the ground.
 */

void
add_pack(THING *obj, bool silent)
{
    THING *op, *lp;
    bool from_floor;

    from_floor = FALSE;
    if (obj == NULL)
    {
	if ((obj = find_obj(hero.y, hero.x)) == NULL)
	    return;
	from_floor = TRUE;
    }

    /*
     * Check for and deal with scare monster scrolls
     */
    if (obj->o_type == SCROLL && obj->o_which == S_SCARE)
	if (obj->o_flags & ISFOUND)
	{
	    detach(lvl_obj, obj);
	    mvaddch(hero.y, hero.x, floor_ch());
	    chat(hero.y, hero.x) = (proom->r_flags & ISGONE) ? PASSAGE : FLOOR;
	    discard(obj);
	    msg("the scroll turns to dust as you pick it up");
	    return;
	}

    if (pack == NULL)
    {
	pack = obj;
	obj->o_packch = pack_char();
	inpack++;
    }
    else
    {
	lp = NULL;
	for (op = pack; op != NULL; op = next(op))
	{
	    if (op->o_type != obj->o_type)
		lp = op;
	    else
	    {
		while (op->o_type == obj->o_type && op->o_which != obj->o_which)
		{
		    lp = op;
		    if (next(op) == NULL)
			break;
		    else
			op = next(op);
		}
		if (op->o_type == obj->o_type && op->o_which == obj->o_which)
		{
		    if (ISMULT(op->o_type))
		    {
			if (!pack_room(from_floor, obj))
			    return;
			op->o_count++;
dump_it:
			discard(obj);
			obj = op;
			lp = NULL;
			goto out;
		    }
		    else if (obj->o_group)
		    {
			lp = op;
			while (op->o_type == obj->o_type
			    && op->o_which == obj->o_which
			    && op->o_group != obj->o_group)
			{
			    lp = op;
			    if (next(op) == NULL)
				break;
			    else
				op = next(op);
			}
			if (op->o_type == obj->o_type
			    && op->o_which == obj->o_which
			    && op->o_group == obj->o_group)
			{
				op->o_count += obj->o_count;
				inpack--;
				if (!pack_room(from_floor, obj))
				    return;
				goto dump_it;
			}
		    }
		    else
			lp = op;
		}
out:
		break;
	    }
	}

	if (lp != NULL)
	{
	    if (!pack_room(from_floor, obj))
		return;
	    else
	    {
		obj->o_packch = pack_char();
		next(obj) = next(lp);
		prev(obj) = lp;
		if (next(lp) != NULL)
		    prev(next(lp)) = obj;
		next(lp) = obj;
	    }
	}
    }

    obj->o_flags |= ISFOUND;

    /*
     * If this was the object of something's desire, that monster will
     * get mad and run at the hero.
     */
    for (op = mlist; op != NULL; op = next(op))
	if (op->t_dest == &obj->o_pos)
	    op->t_dest = &hero;

    if (obj->o_type == AMULET)
	amulet = TRUE;
    /*
     * Notify the user
     */
    if (!silent)
    {
	if (!terse)
	    addmsg("you now have ");
	msg("%s (%c)", inv_name(obj, !terse), obj->o_packch);
    }
}

/*
 * pack_room:
 *	See if there's room in the pack.  If not, print out an
 *	appropriate message
 */
bool
pack_room(bool from_floor, THING *obj)
{
    if (++inpack > MAXPACK)
    {
	if (!terse)
	    addmsg("there's ");
	addmsg("no room");
	if (!terse)
	    addmsg(" in your pack");
	endmsg();
	if (from_floor)
	    move_msg(obj);
	inpack = MAXPACK;
	return FALSE;
    }

    if (from_floor)
    {
	detach(lvl_obj, obj);
	mvaddch(hero.y, hero.x, floor_ch());
	chat(hero.y, hero.x) = (proom->r_flags & ISGONE) ? PASSAGE : FLOOR;
    }

    return TRUE;
}

/*
 * leave_pack:
 *	take an item out of the pack
 */
THING *
leave_pack(THING *obj, bool newobj, bool all)
{
    THING *nobj;
#ifdef ROGUE_LAYERED
    char *split_label = NULL;

    /* Renaming one separated arrow must not free the other's label. Allocate
     * before changing either count so a failure leaves the pack intact. */
    if (newobj && !all && obj->o_count > 1 && obj->o_label != NULL)
    {
        split_label = malloc(strlen(obj->o_label) + 1);
        if (split_label == NULL)
        {
            fatal("Out of memory copying an item label.\n");
            return NULL;
        }
        strcpy(split_label, obj->o_label);
    }
#endif

    inpack--;
    nobj = obj;
    if (obj->o_count > 1 && !all)
    {
	last_pick = obj;
	obj->o_count--;
	if (obj->o_group)
	    inpack++;
	if (newobj)
	{
	    nobj = new_item();
	    *nobj = *obj;
#ifdef ROGUE_LAYERED
            nobj->o_label = split_label;
#endif
	    next(nobj) = NULL;
	    prev(nobj) = NULL;
	    nobj->o_count = 1;
	}
    }
    else
    {
	last_pick = NULL;
	pack_used[obj->o_packch - 'a'] = FALSE;
	detach(pack, obj);
    }
    return nobj;
}

/*
 * pack_char:
 *	Return the next unused pack character.
 */
char
pack_char()
{
    bool *bp;

    for (bp = pack_used; *bp; bp++)
	continue;
    *bp = TRUE;
    return (char)((int)(bp - pack_used) + 'a');
}

/*
 * inventory:
 *	List what is in the pack.  Return TRUE if there is something of
 *	the given type.
 */
bool
inventory(THING *list, int type)
{
    static char inv_temp[MAXSTR];

    n_objs = 0;
    for (; list != NULL; list = next(list))
    {
	if (type && type != list->o_type && !(type == CALLABLE &&
	    list->o_type != FOOD && list->o_type != AMULET) &&
	    !(type == R_OR_S && (list->o_type == RING || list->o_type == STICK)))
		continue;
	n_objs++;
#ifdef MASTER
	if (!list->o_packch)
	    strcpy(inv_temp, "%s");
	else
#endif
	    sprintf(inv_temp, "%c) %%s", list->o_packch);
	msg_esc = TRUE;
	if (add_line(inv_temp, inv_name(list, FALSE)) == ESCAPE)
	{
	    msg_esc = FALSE;
	    msg("");
	    return TRUE;
	}
	msg_esc = FALSE;
    }
    if (n_objs == 0)
    {
	if (terse)
	    msg(type == 0 ? "empty handed" :
			    "nothing appropriate");
	else
	    msg(type == 0 ? "you are empty handed" :
			    "you don't have anything appropriate");
	return FALSE;
    }
    end_line();
    return TRUE;
}

/*
 * pick_up:
 *	Add something to characters pack.
 */

void
pick_up(char ch)
{
    THING *obj;

    if (on(player, ISLEVIT))
	return;

    obj = find_obj(hero.y, hero.x);
    if (move_on)
	move_msg(obj);
    else
	switch (ch)
	{
	    case GOLD:
		if (obj == NULL)
		    return;
		money(obj->o_goldval);
		detach(lvl_obj, obj);
		discard(obj);
		proom->r_goldval = 0;
		break;
	    default:
#ifdef MASTER
		debug("Where did you pick a '%s' up???", unctrl(ch));
#endif
	    case ARMOR:
	    case POTION:
	    case FOOD:
	    case WEAPON:
	    case SCROLL:	
	    case AMULET:
	    case RING:
	    case STICK:
		add_pack((THING *) NULL, FALSE);
		break;
	}
}

/*
 * move_msg:
 *	Print out the message if you are just moving onto an object
 */

void
move_msg(THING *obj)
{
    if (!terse)
	addmsg("you ");
    msg("moved onto %s", inv_name(obj, TRUE));
}

/*
 * picky_inven:
 *	Allow player to inventory a single item
 */

#ifdef ROGUE_LAYERED
/* Observe exactly the public inventory descriptors; C still validates choices. */
static void rg_item_rows(THING *list, int type, const char *scope)
{
    int row = 0;
    rg_ui_clear(scope);
    for (; list != NULL; list = next(list)) {
        if (type && type != list->o_type && !(type == CALLABLE &&
            list->o_type != FOOD && list->o_type != AMULET) &&
            !(type == R_OR_S && (list->o_type == RING || list->o_type == STICK)))
            continue;
        rg_ui_printf(scope, row++, 0, __FILE__, __LINE__, "%c) %s",
                     list->o_packch, inv_name(list, FALSE));
    }
}
static void rg_item_choices(THING *list, int type) { rg_item_rows(list, type, "choices"); }

/* Observational inventory for Rust's item menu, including empty/single packs.
 * No look(), game mutation, RNG, or extra commands. C still executes actions. */
void rg_inventory_browser(void)
{
    if (!rg_host_inventory_browser_enabled()) { inventory(pack, 0); return; }
    rg_ui_line("browse", 0, 0, "ui.text", "[]", "");
    rg_item_rows(pack, 0, "inventory");
    if (pack == NULL) rg_ui_line("inventory", 0, 0, "inventory.empty", "[]", "");
    rg_wait_for(' ', "input.close");
    rg_ui_clear("inventory");
    rg_ui_clear("browse");
}
#endif

void
picky_inven()
{
    THING *obj;
    char mch;

    if (pack == NULL)
	msg("you aren't carrying anything");
    else if (next(pack) == NULL)
	msg("a) %s", inv_name(pack, FALSE));
    else
    {
	msg(terse ? "item: " : "which item do you wish to inventory: ");
	mpos = 0;
#ifdef ROGUE_LAYERED
        rg_item_choices(pack, 0);
        rg_ui_line("input", -2, 0, "input.inventory_one", "[]", "");
#endif
        mch = readchar();
#ifdef ROGUE_LAYERED
        rg_ui_clear("choices");
        rg_ui_clear("input");
#endif
	if (mch == ESCAPE)
	{
	    msg("");
	    return;
	}
	for (obj = pack; obj != NULL; obj = next(obj))
	    if (mch == obj->o_packch)
	    {
		msg("%c) %s", mch, inv_name(obj, FALSE));
		return;
	    }
	msg("'%s' not in pack", unctrl(mch));
    }
}

/*
 * get_item:
 *	Pick something out of a pack for a purpose
 */
THING *
get_item(char *purpose, int type)
{
    THING *obj;
    char ch;
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
    static const struct { const char *english, *id; } purposes[] = {
        {"wear", "action.wear"}, {"charge", "action.charge"}, {"call", "action.call"}, {"eat", "action.eat"},
        {"quaff", "action.quaff"}, {"put on", "action.put_ring"}, {"read", "action.read"}, {"zap with", "action.zap"},
        {"drop", "action.drop"}, {"throw", "action.throw"}, {"wield", "action.wield"}, {"identify", "action.identify"}
    };
    size_t purpose_index;
    for (purpose_index = 0; purpose_index < sizeof purposes / sizeof purposes[0]; ++purpose_index)
        if (!strcmp(purpose, purposes[purpose_index].english)) {
            rg_semantic_register_term(purpose, purposes[purpose_index].id);
            break;
        }
#endif

    if (pack == NULL)
	msg("you aren't carrying anything");
    else if (again)
	if (last_pick)
	    return last_pick;
	else
	    msg("you ran out");
    else
    {
	for (;;)
	{
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
        rg_item_choices(pack, !strcmp(purpose, "throw") ? 0 : type);
        if (purpose_index < sizeof purposes / sizeof purposes[0])
            rg_ui_line("item_action", 0, 0, purposes[purpose_index].id, "[]", "");
        rg_ui_line("input", -2, 0, "input.choose_item", "[]", "");
#endif
	    if (!terse)
		addmsg("which object do you want to ");
	    addmsg(purpose);
	    if (terse)
		addmsg(" what");
	    msg("? (* for list): ");
	    ch = readchar();
#ifdef ROGUE_LAYERED /* RG_UI_PRESENTATION */
        rg_ui_clear("choices");
        rg_ui_clear("item_action");
        rg_ui_clear("input");
#endif
	    mpos = 0;
	    /*
	     * Give the poor player a chance to abort the command
	     */
	    if (ch == ESCAPE)
	    {
		reset_last();
		after = FALSE;
		msg("");
		return NULL;
	    }
	    n_objs = 1;		/* normal case: person types one char */
	    if (ch == '*')
	    {
		mpos = 0;
		if (inventory(pack, type) == 0)
		{
		    after = FALSE;
		    return NULL;
		}
		continue;
	    }
	    for (obj = pack; obj != NULL; obj = next(obj))
		if (obj->o_packch == ch)
		    break;
	    if (obj == NULL)
	    {
		msg("'%s' is not a valid item",unctrl(ch));
		continue;
	    }
	    else 
		return obj;
	}
    }
    return NULL;
}

/*
 * money:
 *	Add or subtract gold from the pack
 */

void
money(int value)
{
    purse += value;
    mvaddch(hero.y, hero.x, floor_ch());
    chat(hero.y, hero.x) = (proom->r_flags & ISGONE) ? PASSAGE : FLOOR;
    if (value > 0)
    {
	if (!terse)
	    addmsg("you found ");
	msg("%d gold pieces", value);
    }
}

/*
 * floor_ch:
 *	Return the appropriate floor character for her room
 */
char
floor_ch()
{
    if (proom->r_flags & ISGONE)
	return PASSAGE;
    return (show_floor() ? FLOOR : ' ');
}

/*
 * floor_at:
 *	Return the character at hero's position, taking see_floor
 *	into account
 */
char
floor_at()
{
    char ch;

    ch = chat(hero.y, hero.x);
    if (ch == FLOOR)
	ch = floor_ch();
    return ch;
}

/*
 * reset_last:
 *	Reset the last command when the current one is aborted
 */

void
reset_last()
{
    last_comm = l_last_comm;
    last_dir = l_last_dir;
    last_pick = l_last_pick;
}
