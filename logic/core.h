#ifndef RG_CORE_INTERNAL_H
#define RG_CORE_INTERNAL_H
#include <stdint.h>
#include <stdio.h>
#include <time.h>
#include "../contract/rogue_abi.h"
/* Internal C adapters; the external ABI lives in contract/rogue_abi.h. */
uint32_t rg_random_next(void);
void rg_core_exit(int code);
void rg_core_abort(void);
void rg_core_set_outcome(int code,const char *message);
void rg_core_tick_complete(void);
uint32_t rg_core_turn(void);
void rg_core_set_turn(uint32_t value);
uint32_t rg_core_runtime_export(uint32_t *out,uint32_t capacity);
int rg_core_runtime_validate(const uint32_t *in,uint32_t words);
int rg_core_runtime_import(const uint32_t *in,uint32_t words);
int rg_core_was_restored(void);
void rg_core_pending(int value);
int rg_console_printf(const char *format,...);
int rg_console_putchar(int ch);
char *rg_console_fgets(char *buffer,int size,FILE *ignored);
int rg_console_getchar(void);
const char *rg_core_player_name(void);
#endif
