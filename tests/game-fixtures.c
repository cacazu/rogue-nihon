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
    if (!strcmp(name, "wall")) {
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
