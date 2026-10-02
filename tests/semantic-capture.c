/* Contract tests for source-derived display data, not a replacement game. */
#include <curses.h>
#include <stdio.h>
#include <string.h>
#include "rogue.h"
#include "semantic.h"
#undef printf
#undef exit
#undef abort

static int output(const char *text)
{
    char json[8192];
    int result=rg_semantic_argument(text,json,sizeof json);
    if(result!=1) {fprintf(stderr,"missing semantic: %s (%d)\n",text,result);return 1;}
    puts(json);return 0;
}
#define CHECK(value) do {if(!(value)) {fprintf(stderr,"semantic check %d failed\n",__LINE__);return 1;}} while(0)

int main(void)
{
    THING object={0};
    char text[100]="two unknown potions",small[4],label[100]="名前 %s%n%%";
    int initial_seed=seed;
    inv_describe=TRUE;
    object.o_type=POTION;object.o_which=P_HEALING;object.o_count=2;
    object.o_flags=ISKNOW|ISCURSED;object.o_hplus=99;object.o_charges=77;
    p_colors[P_HEALING]=rainbow[2];pot_info[P_HEALING].oi_know=FALSE;
    rg_semantic_item(text,&object,0);CHECK(output(text)==0);
    pot_info[P_HEALING].oi_know=TRUE;
    rg_semantic_item(text,&object,1);CHECK(output(text)==0);

    object.o_type=RING;object.o_which=R_PROTECT;object.o_arm=7;
    ring_info[R_PROTECT].oi_know=FALSE;ring_info[R_PROTECT].oi_guess=NULL;
    r_stones[R_PROTECT]=stones[3].st_name;
    rg_semantic_item(text,&object,0);CHECK(output(text)==0);
    ring_info[R_PROTECT].oi_guess="自作 %s%n";
    rg_semantic_item(text,&object,0);CHECK(output(text)==0);

    object.o_type=WEAPON;object.o_which=MACE;object.o_flags=ISCURSED;
    object.o_label=label;object.o_hplus=3;object.o_dplus=4;
    cur_weapon=&object;
    rg_semantic_item(text,&object,0);
    strcpy(label,"changed after capture");
    CHECK(output(text)==0);
    object.o_flags=ISKNOW;
    rg_semantic_item(text,&object,0);CHECK(output(text)==0);
    object.o_type=ARMOR;object.o_which=LEATHER;object.o_arm=5;
    cur_weapon=NULL;cur_armor=&object;
    rg_semantic_item(text,&object,0);CHECK(output(text)==0);

    rg_semantic_monster(text,7,"name",1,0,1);CHECK(output(text)==0);
    {char combatant[100]="The hallucinated name";
     rg_semantic_combatant(combatant,text,1);CHECK(output(combatant)==0);}
    rg_semantic_combatant(text,NULL,0);CHECK(output(text)==0);
    CHECK(output(tr_name[5])==0);
    CHECK(output(weap_info[ARROW].oi_name)==0);
    weap_info[FLAME].oi_name="flame";
    CHECK(output(weap_info[FLAME].oi_name)==0);
    CHECK(output(rainbow[2])==0);
    CHECK(output(fruit)==0);
    CHECK(output(whoami)==0);
    { char name_copy[100]; strcpy(name_copy,whoami);
      rg_semantic_copy(name_copy,whoami);CHECK(output(name_copy)==0); }

    rg_semantic_register_term(text,"term.direction");CHECK(output(text)==0);
    CHECK(rg_semantic_argument(text,small,sizeof small)==-1);
    strcpy(text,"different English bytes");
    CHECK(rg_semantic_argument(text,small,sizeof small)==0);
    rg_semantic_register_message(text,"message.test","[{\"kind\":\"string\",\"value\":\"自由名 %n\"}]");
    CHECK(output(text)==0);
    CHECK(seed==initial_seed);
    puts("{\"checks\":\"pass\",\"seed_unchanged\":true}");
    return 0;
}
