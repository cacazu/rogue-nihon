/* Test builds only: controlled, valid states using original Rogue APIs.
 * Both independent original-rule and split modules link this exact source.
 * These are induced regression states, not claims about random new-game maps.
 * No fixture code is linked into the production build.
 */
#include <curses.h>
#include "rogue.h"
#include <stdio.h>
#include <string.h>
#include <stdlib.h>

#ifndef RG_TEST_FIXTURES
#error "game-fixtures.c must only be linked into a RG_TEST_FIXTURES build"
#endif

static void clear_objects(THING **list)
{
    THING *item, *next_item;
    for (item = *list; item; item = next_item) {
        next_item = next(item);
        /* Fresh startup items have no labels and no shared ownership. */
        free(item->o_label);
        discard(item);
    }
    *list = NULL;
}

static void clean_world(void)
{
    THING *monster, *next_monster;
    struct room *room;
    int n;
    for (monster = mlist; monster; monster = next_monster) {
        next_monster = next(monster);
        clear_objects(&monster->t_pack);
        discard(monster);
    }
    mlist = NULL;
    clear_objects(&lvl_obj);
    clear_objects(&player.t_pack);
    cur_weapon = cur_armor = cur_ring[0] = cur_ring[1] = NULL;
    l_last_pick = last_pick = NULL;
    memset(pack_used, 0, 26 * sizeof(pack_used[0]));
    inpack = 0;
    init_player();
    memset(places, 0, MAXCOLS * MAXLINES * sizeof(places[0]));
    for (n = 0; n < MAXCOLS * MAXLINES; n++) {
        places[n].p_ch = ' ';
        places[n].p_flags = F_REAL;
    }
    memset(rooms, 0, MAXROOMS * sizeof(rooms[0]));
    for (n = 0; n < MAXROOMS; n++) {
        rooms[n].r_pos.x = 50;
        rooms[n].r_pos.y = 10;
        rooms[n].r_max.x = -NUMCOLS;
        rooms[n].r_max.y = -NUMLINES;
        rooms[n].r_flags = ISGONE;
    }
    memset(passages, 0, MAXPASS * sizeof(passages[0]));
    for (n = 0; n < MAXPASS; n++) passages[n].r_flags = ISGONE | ISDARK;
    room = &rooms[0];
    room->r_pos.x = 2; room->r_pos.y = 2;
    room->r_max.x = 25; room->r_max.y = 20;
    room->r_flags = 0;
    level = max_level = 1;
    ntraps = n_objs = no_food = 0;
    food_left = 1000;
    hungry_state = no_command = no_move = quiet = between = 0;
    running = again = to_death = FALSE;
    after = TRUE;
    count = 0;
    last_comm = last_dir = l_last_comm = l_last_dir = 0;
    mpos = 0;
    huh[0] = 0;
    player.t_flags = ISRUN;
    hero.x = 10; hero.y = 10;
    oldpos = hero;
    oldrp = proom = room;
    stairs.x = 15; stairs.y = 10;
    draw_room(room);
    chat(stairs.y, stairs.x) = STAIRS;
    clear();
    /* This paints the original bright-room knowledge before enemies exist.
     * new_monster must see FLOOR through inch(), without premature wake/gaze. */
    enter_room(&hero);
    seenstairs = TRUE;
    /* Original effects are isolated from random level wanderer scheduling. */
    for (n = 0; n < MAXDAEMONS; n++) memset(&d_list[n], 0, sizeof(d_list[n]));
    start_daemon(runners, 0, AFTER);
    start_daemon(doctor, 0, AFTER);
    start_daemon(stomach, 0, AFTER);
    pstats.s_hpt = pstats.s_maxhp = 100;
    max_stats.s_hpt = max_stats.s_maxhp = 100;
}

static THING *monster_at(char type, int x, int y)
{
    coord position;
    THING *monster = new_item();
    position.x = x; position.y = y;
    new_monster(monster, type, &position);
    return monster;
}

static void potion(int type)
{
    THING *object = new_item();
    object->o_type = POTION;
    object->o_which = type;
    object->o_count = 1;
    object->o_arm = 11;
    strcpy(object->o_damage, "0x0");
    strcpy(object->o_hurldmg, "0x0");
    /* f follows the original five initial pack items, eliminating call_it. */
    pot_info[type].oi_know = TRUE;
    add_pack(object, TRUE);
}

void rg_test_apply_fixture(void)
{
    FILE *file;
    char name[64];
    size_t name_length;
    THING *monster, *object;
    int ending = 0;
    file = fopen("/fixture.id", "rb");
    if (!file) return;
    /* rogue.h redirects fgets to console input; fread reads the MEMFS file. */
    name_length = fread(name, 1, sizeof(name) - 1, file);
    fclose(file);
    if (!name_length) return;
    name[name_length] = 0;
    name[strcspn(name, "\r\n")] = 0;
    clean_world();
    if (!strcmp(name,"actor-underfoot-moving")) {
        int x;
        for (x = 11; x <= 14; x++) {
            chat(9,x) = chat(11,x) = '-';
            mvaddch(9,x,'-'); mvaddch(11,x,'-');
            chat(10,x) = x == 11 ? PASSAGE : x == 12 ? DOOR : x == 13 ? STAIRS : FLOOR;
            mvaddch(10,x,chat(10,x));
        }
        monster = monster_at('E',14,10);
        monster->t_flags |= ISRUN;
        monster->t_dest = &hero;
        monster->t_stats.s_hpt = monster->t_stats.s_maxhp = 100;
        enter_room(&hero);
    } else if (!strncmp(name, "actor-underfoot", 15)) {
        int i;
        const char terrain[] = {PASSAGE, DOOR, STAIRS, TRAP, FLOOR};
        const char types[] = {'E','O','Z','H','F'};
        for (i = 0; i < 5; i++) {
            int x = 11 + i;
            chat(10,x) = terrain[i];
            mvaddch(10,x,terrain[i]);
            monster = monster_at(types[i],x,10);
            monster->t_flags &= ~(ISMEAN | ISRUN);
            monster->t_stats.s_hpt = monster->t_stats.s_maxhp = 100;
        }
        enter_room(&hero);
        if (!strcmp(name,"actor-underfoot-detected")) {
            rooms[0].r_flags |= ISDARK;
            player.t_flags |= ISBLIND | SEEMONST;
            for (monster = mlist; monster; monster = next(monster)) {
                monster->t_oldch = ' ';
                mvaddch(monster->t_pos.y,monster->t_pos.x,monster->t_disguise);
            }
        }
    } else if (!strncmp(name, "inventory-", 10)) {
        int i;
        if (!strcmp(name, "inventory-empty") || !strcmp(name, "inventory-single")) {
            clear_objects(&player.t_pack);
            cur_weapon = cur_armor = cur_ring[0] = cur_ring[1] = NULL;
            memset(pack_used, 0, 26 * sizeof(pack_used[0])); inpack = 0;
            if (!strcmp(name, "inventory-single")) {
                object = new_item(); object->o_type = FOOD; object->o_count = 1;
                add_pack(object, TRUE);
            }
        } else {
            potion(P_HEALING); /* f */
            object = new_item(); object->o_type = SCROLL; object->o_which = S_ARMOR; object->o_count = 1;
            scr_info[S_ARMOR].oi_know = TRUE; add_pack(object, TRUE); /* g */
            for (i = 0; i < 2; i++) {
                object = new_item(); object->o_type = RING; object->o_which = i ? R_ADDSTR : R_PROTECT;
                object->o_count = 1; object->o_arm = 1; object->o_flags = ISKNOW;
                ring_info[object->o_which].oi_know = TRUE; add_pack(object, TRUE); /* h, i */
            }
            object = new_item(); object->o_type = STICK; object->o_which = WS_LIGHT; object->o_count = 1;
            object->o_charges = 5; object->o_flags = ISKNOW;
            ws_info[WS_LIGHT].oi_know = TRUE; add_pack(object, TRUE); /* j */
            object = new_item(); object->o_type = ARMOR; object->o_which = CHAIN_MAIL; object->o_count = 1;
            object->o_arm = a_class[CHAIN_MAIL]; add_pack(object, TRUE); /* k */
            object = new_item(); object->o_type = POTION; object->o_which = P_POISON; object->o_count = 1;
            pot_info[P_POISON].oi_know = FALSE; object->o_flags = ISCURSED;
            add_pack(object, TRUE); /* l: all hidden knowledge must stay hidden */
            object = new_item(); object->o_type = WEAPON; object->o_which = DAGGER; object->o_count = 1;
            object->o_hplus = 7; object->o_dplus = -3; object->o_flags = ISCURSED;
            strcpy(object->o_damage, "1x6"); strcpy(object->o_hurldmg, "1x4"); add_pack(object, TRUE); /* m */
            if (!strcmp(name, "inventory-cursed")) {
                cur_weapon->o_flags |= ISCURSED; cur_armor->o_flags |= ISCURSED;
                for (object = pack; object; object = next(object)) {
                    if (object->o_packch == 'h') cur_ring[LEFT] = object;
                    if (object->o_packch == 'i') cur_ring[RIGHT] = object;
                }
                cur_ring[LEFT]->o_flags |= ISCURSED;
            } else if (strcmp(name, "inventory-all")) abort();
        }
    } else if (!strncmp(name, "graphics-beam-", 14)) {
        coord direction;
        direction.x = name[14] == 'v' ? 0 : 1;
        direction.y = name[14] == 'h' ? 0 : name[14] == 's' ? -1 : 1;
        if (!strchr("hvsb", name[14]) || name[15]) abort();
        fire_bolt(&hero, &direction, "flame");
    } else if (!strncmp(name, "bug-identify-empty-", 19)) {
        const char *kind = name + 19;
        int scroll_type;
        if (!strcmp(kind, "potion")) scroll_type = S_ID_POTION;
        else if (!strcmp(kind, "scroll")) scroll_type = S_ID_SCROLL;
        else if (!strcmp(kind, "weapon")) scroll_type = S_ID_WEAPON;
        else if (!strcmp(kind, "armor")) scroll_type = S_ID_ARMOR;
        else if (!strcmp(kind, "ring-stick")) scroll_type = S_ID_R_OR_S;
        else abort();
        clear_objects(&player.t_pack);
        cur_weapon = cur_armor = cur_ring[0] = cur_ring[1] = NULL;
        memset(pack_used, 0, 26 * sizeof(pack_used[0])); inpack = 0;
        object = new_item(); object->o_type = FOOD; object->o_count = 1;
        add_pack(object, TRUE); /* a */
        object = new_item(); object->o_type = SCROLL; object->o_which = scroll_type;
        object->o_count = 1; scr_info[scroll_type].oi_know = TRUE;
        add_pack(object, TRUE); /* b */
    } else if (!strcmp(name, "bug-identify-potion") || !strcmp(name, "bug-naming")) {
        potion(P_RESTORE); /* f */
        pot_info[P_RESTORE].oi_know = FALSE;
        if (!strcmp(name, "bug-naming")) {
            potion(P_POISON); /* g, last inventory item overwrites prbuf */
            pot_info[P_POISON].oi_know = FALSE;
        } else {
            object = new_item(); object->o_type = SCROLL; object->o_which = S_ID_POTION;
            object->o_count = 1; scr_info[S_ID_POTION].oi_know = TRUE;
            add_pack(object, TRUE); /* g */
        }
    } else if (!strcmp(name, "bug-translation")) {
        food_left = 2 * MORETIME;
        object = new_item(); object->o_type = SCROLL; object->o_which = S_REMOVE;
        object->o_count = 1; scr_info[S_REMOVE].oi_know = TRUE;
        add_pack(object, TRUE); /* f */
    } else if (!strcmp(name, "bug-death-combat")) {
        purse = 468;
        pstats.s_hpt = 6;
        monster = monster_at('O', 11, 10);
        monster->t_flags |= ISMEAN | ISRUN;
        monster->t_flags &= ~ISHELD;
        monster->t_dest = &hero;
        strcpy(monster->t_stats.s_dmg, "1x20");
        monster->t_stats.s_lvl = 100;
    } else if (!strcmp(name, "item-identify")) {
        object = new_item();
        object->o_type = SCROLL; object->o_which = S_ID_WEAPON; object->o_count = 1;
        object->o_arm = 11;
        strcpy(object->o_damage, "0x0"); strcpy(object->o_hurldmg, "0x0");
        scr_info[S_ID_WEAPON].oi_know = TRUE;
        add_pack(object, TRUE);
    } else if (!strcmp(name, "space-discoveries")) {
        int i;
        for (i = 0; i < MAXPOTIONS; i++) pot_info[i].oi_know = TRUE;
        for (i = 0; i < MAXSCROLLS; i++) scr_info[i].oi_know = TRUE;
        for (i = 0; i < MAXRINGS; i++) ring_info[i].oi_know = TRUE;
        for (i = 0; i < MAXSTICKS; i++) ws_info[i].oi_know = TRUE;
    } else if (!strcmp(name, "space-detection")) {
        potion(P_TFIND);
        object = new_item();
        object->o_type = SCROLL; object->o_which = S_FDET; object->o_count = 1;
        object->o_arm = 11;
        strcpy(object->o_damage, "0x0"); strcpy(object->o_hurldmg, "0x0");
        scr_info[S_FDET].oi_know = TRUE;
        add_pack(object, TRUE);
        object = new_item();
        object->o_type = FOOD; object->o_which = 0; object->o_count = 1;
        object->o_pos.x = 12; object->o_pos.y = 10;
        strcpy(object->o_damage, "0x0"); strcpy(object->o_hurldmg, "0x0");
        attach(lvl_obj, object);
        chat(10, 12) = FOOD; mvaddch(10, 12, FOOD);
        object = new_item();
        object->o_type = POTION; object->o_which = P_HEALING; object->o_count = 1;
        object->o_pos.x = 13; object->o_pos.y = 10;
        object->o_arm = 11;
        strcpy(object->o_damage, "0x0"); strcpy(object->o_hurldmg, "0x0");
        attach(lvl_obj, object);
        chat(10, 13) = POTION; mvaddch(10, 13, POTION);
    } else if (!strcmp(name, "space-single-item") || !strcmp(name, "space-empty-pack")) {
        clear_objects(&player.t_pack);
        cur_weapon = cur_armor = cur_ring[0] = cur_ring[1] = NULL;
        memset(pack_used, 0, 26 * sizeof(pack_used[0]));
        inpack = 0;
        if (!strcmp(name, "space-single-item")) {
            object = new_item();
            object->o_type = FOOD; object->o_count = 1;
            strcpy(object->o_damage, "0x0"); strcpy(object->o_hurldmg, "0x0");
            add_pack(object, TRUE);
        }
    } else if (!strcmp(name, "wall")) {
        chat(hero.y, hero.x - 1) = '|';
        mvaddch(hero.y, hero.x - 1, '|');
    } else if (!strcmp(name, "haste")) {
        add_haste(FALSE);
    } else if (!strcmp(name, "haste-potion")) {
        potion(P_HASTE);
    } else if (!strcmp(name, "double-haste")) {
        add_haste(FALSE);
        potion(P_HASTE);
    } else if (!strcmp(name, "sleep-haste")) {
        add_haste(FALSE);
        no_command = 3;
        player.t_flags &= ~ISRUN;
    } else if (!strcmp(name, "mean")) {
        monster = monster_at('E', 11, 10);
        monster->t_flags |= ISMEAN;
        monster->t_flags &= ~(ISRUN | ISHELD);
    } else if (!strcmp(name, "medusa")) {
        monster = monster_at('M', 11, 10);
        monster->t_flags |= ISMEAN | ISRUN;
        monster->t_flags &= ~(ISFOUND | ISCANC);
        monster->t_dest = &hero;
    } else if (!strcmp(name, "hallucination")) {
        monster = monster_at('E', 11, 10);
        monster->t_flags |= ISHELD;
        monster->t_flags &= ~ISRUN;
        object = new_item();
        object->o_type = POTION; object->o_which = P_HEALING; object->o_count = 1;
        object->o_pos.x = 12; object->o_pos.y = 10;
        object->o_arm = 11;
        strcpy(object->o_damage, "0x0"); strcpy(object->o_hurldmg, "0x0");
        attach(lvl_obj, object);
        chat(10, 12) = POTION;
        mvaddch(10, 12, POTION);
        player.t_flags |= ISHALU;
        start_daemon(visuals, 0, BEFORE);
        fuse(come_down, 0, 50, AFTER);
    } else if (!strcmp(name, "nymph-stack")) {
        /* Only the enchanted stack is eligible for theft. Exercise attack(),
         * pack splitting and the save walker rather than a fake theft event. */
        clear_objects(&player.t_pack);
        cur_weapon = cur_armor = cur_ring[0] = cur_ring[1] = NULL;
        memset(pack_used, 0, 26 * sizeof(pack_used[0]));
        inpack = 0;
        object = new_item();
        init_weapon(object, SHIRAKEN);
        object->o_count = 14;
        object->o_hplus = 1;
        add_pack(object, TRUE);
        monster = monster_at('N', 11, 10);
        monster->t_flags |= ISRUN;
        monster->t_dest = &hero;
    } else if (!strcmp(name, "label-split")) {
        THING *copy;
        for (object = pack; object && !(object->o_type == WEAPON && object->o_which == ARROW); object = next(object)) { }
        if (!object || object->o_count < 2) abort();
        object->o_label = malloc(7);
        if (!object->o_label) abort();
        strcpy(object->o_label, "bundle");
        copy = leave_pack(object, TRUE, FALSE);
        /* Run this ownership assertion only on split. Original shallow-copy
         * behavior is an acknowledged memory safety defect, not a golden. */
        if (!copy || copy->o_label == object->o_label || strcmp(copy->o_label, "bundle")) abort();
        copy->o_pos.x = 12; copy->o_pos.y = 10;
        attach(lvl_obj, copy);
        chat(10, 12) = WEAPON;
        mvaddch(10, 12, WEAPON);
        free(object->o_label);
        object->o_label = malloc(8);
        if (!object->o_label) abort();
        strcpy(object->o_label, "renamed");
        if (strcmp(copy->o_label, "bundle")) abort();
    } else if (!strcmp(name, "percent-recall")) {
        /* Induce an existing user message; test the real CTRL(P) call site,
         * without depending on catalog entries for this test-only source. */
        strcpy(huh, "item called %s%n%%");
        mpos = 0;
    } else if (!strcmp(name, "ending-death")) {
        tombstone = TRUE;
        purse = 123;
        ending = 1;
    } else if (!strcmp(name, "ending-no-tomb")) {
        tombstone = FALSE;
        purse = 123;
        ending = 1;
    } else if (!strcmp(name, "ending-victory")) {
        purse = 123;
        ending = 2;
    } else if (!strcmp(name, "combat")) {
        monster = monster_at('E', 11, 10);
        monster->t_flags |= ISMEAN | ISRUN;
        monster->t_flags &= ~ISHELD;
        monster->t_dest = &hero;
        monster->t_stats.s_hpt = monster->t_stats.s_maxhp = 100;
    } else if (!strcmp(name, "see-invisible")) {
        strcpy(fruit, "\xe7\xab\x9c\xe6\x9e\x9c %s%n%%");
        potion(P_SEEINVIS);
    } else if (!strcmp(name, "see-invisible-plain")) {
        strcpy(fruit, "slime-mold");
        potion(P_SEEINVIS);
    } else if (strcmp(name, "plain") && strcmp(name, "armor") && strcmp(name, "count") && strcmp(name, "repeat") && strcmp(name, "more")) {
        /* Test typo cannot silently run a different scenario. */
        fprintf(stderr, "unknown regression fixture: %s\n", name);
        abort();
    }
    /* Make branch selection reproducible after original setup API RNG calls. */
    seed = dnum;
    /* Localization-only terminal screens use the real original APIs. Keep the
     * seed reset before entry so no fixture observation introduces RNG calls. */
    if (ending == 1) death('E');
    else if (ending == 2) total_winner();
}
