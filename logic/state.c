/*
    state.c - Portable Rogue Save State Code

    Copyright (C) 1999, 2000, 2005 Nicholas J. Kisseberth
    All rights reserved.

    Redistribution and use in source and binary forms, with or without
    modification, are permitted provided that the following conditions
    are met:
    1. Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.
    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.
    3. Neither the name(s) of the author(s) nor the names of other contributors
       may be used to endorse or promote products derived from this software
       without specific prior written permission.

    THIS SOFTWARE IS PROVIDED BY THE AUTHOR(S) AND CONTRIBUTORS ``AS IS'' AND
    ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
    IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
    ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR(S) OR CONTRIBUTORS BE LIABLE
    FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
    DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
    OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
    HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
    LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
    OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
    SUCH DAMAGE.
*/

#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <limits.h>
#include "knowledge.h"
#include "rogue.h"
#include "state_codec.h"

/************************************************************************/
/* Save State Code                                                      */
/************************************************************************/

#define RSID_STATS        0xABCD0001
#define RSID_THING        0xABCD0002
#define RSID_THING_NULL   0xDEAD0002
#define RSID_OBJECT       0xABCD0003
#define RSID_MAGICITEMS   0xABCD0004
#define RSID_KNOWS        0xABCD0005
#define RSID_GUESSES      0xABCD0006
#define RSID_OBJECTLIST   0xABCD0007
#define RSID_BAGOBJECT    0xABCD0008
#define RSID_MONSTERLIST  0xABCD0009
#define RSID_MONSTERSTATS 0xABCD000A
#define RSID_MONSTERS     0xABCD000B
#define RSID_TRAP         0xABCD000C
#define RSID_WINDOW       0xABCD000D
#define RSID_DAEMONS      0xABCD000E
#define RSID_IWEAPS       0xABCD000F
#define RSID_IARMOR       0xABCD0010
#define RSID_SPELLS       0xABCD0011
#define RSID_ILIST        0xABCD0012
#define RSID_HLIST        0xABCD0013
#define RSID_DEATHTYPE    0xABCD0014
#define RSID_CTYPES       0XABCD0015
#define RSID_COORDLIST    0XABCD0016
#define RSID_ROOMS        0XABCD0017

#define READSTAT (format_error || read_error )
#define WRITESTAT (write_error)

static int read_error   = FALSE;
static int write_error  = FALSE;
static int format_error = FALSE;
#define RS_MAX_NODES 16384
#define RS_MAX_STRING MAXSTR
typedef char rs_requires_32_bit_int[(sizeof(int) == 4) ? 1 : -1];

/* The file codec remains available for the historical terminal path.  The Web
 * adapter uses a bounded byte stream, without FILE, XOR, or OS operations. */
static int rs_web_mode = 0;
static uint8_t *rs_output;
static uint32_t rs_output_length, rs_output_capacity;
static const uint8_t *rs_input;
static uint32_t rs_input_length, rs_input_offset;
static uint32_t rs_allocated_bytes, rs_allocated_nodes;

struct rs_allocation {
    void *pointer;
    struct rs_allocation *next;
};
static struct rs_allocation *rs_allocations;

static void
rs_reset(void)
{
    read_error = write_error = format_error = FALSE;
}

static void *
rs_allocate(size_t size)
{
    struct rs_allocation *entry;
    void *pointer;
    if (READSTAT || size == 0 || size > RG_SAVE_MAX_BYTES)
        return NULL;
    if (!rs_web_mode) {
        pointer = calloc(1, size);
        if (pointer == NULL) read_error = TRUE;
        return pointer;
    }
    if (rs_allocated_nodes >= RS_MAX_NODES ||
        size > RG_SAVE_MAX_BYTES - rs_allocated_bytes) {
        format_error = TRUE;
        return NULL;
    }
    entry = malloc(sizeof *entry);
    pointer = calloc(1, size);
    if (entry == NULL || pointer == NULL) {
        free(entry);
        free(pointer);
        read_error = TRUE;
        return NULL;
    }
    entry->pointer = pointer;
    entry->next = rs_allocations;
    rs_allocations = entry;
    rs_allocated_bytes += (uint32_t)size;
    rs_allocated_nodes++;
    return pointer;
}

static void
rs_finish_allocations(int rollback)
{
    struct rs_allocation *entry;
    while ((entry = rs_allocations) != NULL) {
        rs_allocations = entry->next;
        if (rollback) free(entry->pointer);
        free(entry);
    }
    rs_allocated_bytes = rs_allocated_nodes = 0;
}

int
rs_write(FILE *savef, void *ptr, size_t size)
{
    uint32_t needed, capacity;
    uint8_t *grown;
    if (write_error)
        return(WRITESTAT);
    if (size == 0) return 0;
    if (ptr == NULL) { write_error = TRUE; return WRITESTAT; }
    if (rs_web_mode) {
        if (size > RG_SAVE_MAX_BYTES - rs_output_length) {
            write_error = TRUE;
            return WRITESTAT;
        }
        needed = rs_output_length + (uint32_t)size;
        if (needed > rs_output_capacity) {
            capacity = rs_output_capacity ? rs_output_capacity : 4096;
            while (capacity < needed) {
                if (capacity > RG_SAVE_MAX_BYTES / 2) {
                    capacity = RG_SAVE_MAX_BYTES;
                    break;
                }
                capacity *= 2;
            }
            grown = realloc(rs_output, capacity);
            if (grown == NULL) { write_error = TRUE; return WRITESTAT; }
            rs_output = grown;
            rs_output_capacity = capacity;
        }
        memcpy(rs_output + rs_output_length, ptr, size);
        rs_output_length = needed;
    } else if (savef == NULL || encwrite(ptr, size, savef) != size)
        write_error = TRUE;

    return(WRITESTAT);
}

int
rs_read(FILE *inf, void *ptr, size_t size)
{
    if (read_error || format_error)
        return(READSTAT);

    if (size == 0) return 0;
    if (ptr == NULL) { format_error = TRUE; return READSTAT; }
    if (rs_web_mode) {
        if (size > rs_input_length - rs_input_offset) {
            read_error = TRUE;
            return READSTAT;
        }
        memcpy(ptr, rs_input + rs_input_offset, size);
        rs_input_offset += (uint32_t)size;
    } else if (inf == NULL || encread(ptr, size, inf) != size)
        read_error = TRUE;
       
    return(READSTAT);
}

int
rs_write_int(FILE *savef, int c)
{
    uint32_t value = (uint32_t)c;
    uint8_t bytes[4] = { (uint8_t)value, (uint8_t)(value >> 8),
                        (uint8_t)(value >> 16), (uint8_t)(value >> 24) };
    return rs_write(savef, bytes, sizeof bytes);
}

int
rs_read_int(FILE *inf, int *i)
{
    uint8_t bytes[4];
    uint32_t value;
    if (rs_read(inf, bytes, sizeof bytes)) return READSTAT;
    value = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
            ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
    *i = value <= INT32_MAX ? (int)value : -1 - (int)(UINT32_MAX - value);
    return 0;
}

int
rs_write_char(FILE *savef, char c)
{
    if (write_error)
        return(WRITESTAT);

    rs_write(savef, &c, 1);

    return(WRITESTAT);
}

int
rs_read_char(FILE *inf, char *c)
{
    if (read_error || format_error)
        return(READSTAT);

    rs_read(inf, c, 1);

    return(READSTAT);
}

int
rs_write_chars(FILE *savef, char *c, int count)
{
    if (write_error)
        return(WRITESTAT);

    if (count < 0 || count > (int)RG_SAVE_MAX_BYTES) {
        write_error = TRUE;
        return WRITESTAT;
    }
    rs_write_int(savef, count);
    rs_write(savef, c, count);

    return(WRITESTAT);
}

int
rs_read_chars(FILE *inf, char *i, int count)
{
    int value = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf, &value);
    
    if (READSTAT || count < 0 || value != count)
        format_error = TRUE;

    rs_read(inf, i, count);
    
    return(READSTAT);
}

int
rs_write_ints(FILE *savef, int *c, int count)
{
    int n = 0;

    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, count);

    for(n = 0; n < count; n++)
        if( rs_write_int(savef,c[n]) != 0)
            break;

    return(WRITESTAT);
}

int
rs_read_ints(FILE *inf, int *i, int count)
{
    int n = 0, value = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf,&value);

    if (value != count)
        format_error = TRUE;

    for(n = 0; n < count; n++)
        if (rs_read_int(inf, &i[n]) != 0)
            break;
    
    return(READSTAT);
}

int
rs_write_boolean(FILE *savef, int c)
{
    unsigned char buf = (c == 0) ? 0 : 1;
    
    if (write_error)
        return(WRITESTAT);

    rs_write(savef, &buf, 1);

    return(WRITESTAT);
}

int
rs_read_boolean(FILE *inf, bool *i)
{
    unsigned char buf = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read(inf, &buf, 1);
    if (READSTAT) return READSTAT;
    if (buf > 1) { format_error = TRUE; return READSTAT; }
    *i = (buf != 0);
    
    return(READSTAT);
}

int
rs_write_booleans(FILE *savef, bool *c, int count)
{
    int n = 0;

    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, count);

    for(n = 0; n < count; n++)
        if (rs_write_boolean(savef, c[n]) != 0)
            break;

    return(WRITESTAT);
}

int
rs_read_booleans(FILE *inf, bool *i, int count)
{
    int n = 0, value = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf,&value);

    if (value != count)
        format_error = TRUE;

    for(n = 0; n < count; n++)
        if (rs_read_boolean(inf, &i[n]) != 0)
            break;
    
    return(READSTAT);
}

int
rs_write_short(FILE *savef, short c)
{
    uint16_t value = (uint16_t)c;
    uint8_t bytes[2] = { (uint8_t)value, (uint8_t)(value >> 8) };
    return rs_write(savef, bytes, sizeof bytes);
}

int
rs_read_short(FILE *inf, short *i)
{
    uint8_t bytes[2];
    uint16_t value;
    if (rs_read(inf, bytes, sizeof bytes)) return READSTAT;
    value = (uint16_t)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8));
    *i = value <= INT16_MAX ? (short)value : (short)(-1 - (int)(UINT16_MAX - value));
    return 0;
} 

int
rs_write_shorts(FILE *savef, short *c, int count)
{
    int n = 0;

    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, count);

    for(n = 0; n < count; n++)
        if (rs_write_short(savef, c[n]) != 0)
            break; 

    return(WRITESTAT);
}

int
rs_read_shorts(FILE *inf, short *i, int count)
{
    int n = 0, value = 0;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf,&value);

    if (value != count)
        format_error = TRUE;

    for(n = 0; n < count; n++)
        if (rs_read_short(inf, &i[n]) != 0)
            break;
    
    return(READSTAT);
}

int
rs_write_ushort(FILE *savef, unsigned short c)
{
    uint8_t bytes[2] = { (uint8_t)c, (uint8_t)(c >> 8) };
    return rs_write(savef, bytes, sizeof bytes);
}

int
rs_read_ushort(FILE *inf, unsigned short *i)
{
    uint8_t bytes[2];
    if (rs_read(inf, bytes, sizeof bytes)) return READSTAT;
    *i = (unsigned short)((uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8));
    return 0;
} 

int
rs_write_uint(FILE *savef, unsigned int c)
{
    uint8_t bytes[4] = { (uint8_t)c, (uint8_t)(c >> 8),
                        (uint8_t)(c >> 16), (uint8_t)(c >> 24) };
    return rs_write(savef, bytes, sizeof bytes);
}

int
rs_read_uint(FILE *inf, unsigned int *i)
{
    uint8_t bytes[4];
    if (rs_read(inf, bytes, sizeof bytes)) return READSTAT;
    *i = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) |
         ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
    return 0;
}

int
rs_write_marker(FILE *savef, int id)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, id);

    return(WRITESTAT);
}

int 
rs_read_marker(FILE *inf, int id)
{
    int nid;

    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf, &nid) == 0)
        if (id != nid)
            format_error = 1;
    
    return(READSTAT);
}



/******************************************************************************/

int
rs_write_string(FILE *savef, char *s)
{
    int len = 0;

    if (write_error)
        return(WRITESTAT);

    if (s != NULL && strlen(s) >= RS_MAX_STRING) {
        write_error = TRUE;
        return WRITESTAT;
    }
    len = (s == NULL) ? 0 : (int) strlen(s) + 1;

    rs_write_int(savef, len);
    rs_write_chars(savef, s, len);
            
    return(WRITESTAT);
}

int
rs_read_string(FILE *inf, char *s, int max)
{
    int len = 0;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf, &len);

    if (READSTAT || len < 0 || len > max || max < 0)
        format_error = TRUE;

    rs_read_chars(inf, s, len);
    if (!READSTAT && len > 0 && s[len - 1] != '\0')
        format_error = TRUE;
    
    return(READSTAT);
}

int
rs_read_new_string(FILE *inf, char **s)
{
    int len=0;
    char *buf=0;

    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf, &len)) return READSTAT;
    if (len < 0 || len > RS_MAX_STRING) {
        format_error = TRUE;
        return READSTAT;
    }
    if (len > 0) {
        buf = rs_allocate((size_t)len);
        if (buf == NULL) return READSTAT;
    }
    rs_read_chars(inf, buf, len);
    if (!READSTAT && len > 0 && buf[len - 1] != '\0')
        format_error = TRUE;
    if (!READSTAT) *s = buf;
    else if (!rs_web_mode) free(buf);

    return(READSTAT);
}

int
rs_write_strings(FILE *savef, char *s[], int count)
{
    int n = 0;

    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, count);

    for(n = 0; n < count; n++)
        if (rs_write_string(savef, s[n]) != 0)
            break;
    
    return(WRITESTAT);
}

int
rs_read_strings(FILE *inf, char **s, int count, int max)
{
    int n     = 0;
    int value = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf, &value);

    if (value != count)
        format_error = TRUE;

    for(n = 0; n < count; n++)
        if (rs_read_string(inf, s[n], max) != 0)
            break;
    
    return(READSTAT);
}

int
rs_read_new_strings(FILE *inf, char **s, int count)
{
    int n     = 0;
    int value = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf, &value);

    if (value != count)
        format_error = TRUE;

    for(n = 0; n < count; n++)
        if (rs_read_new_string(inf, &s[n]) != 0)
            break;
    
    return(READSTAT);
}

int
rs_write_string_index(FILE *savef, char *master[], int max, const char *str)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < max; i++)
        if (str == master[i])
            return( rs_write_int(savef, i) );

    return( rs_write_int(savef,-1) );
}

int
rs_read_string_index(FILE *inf, char *master[], int maxindex, char **str)
{
    int i = -1;

    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf, &i)) return READSTAT;
    if (i < -1 || i >= maxindex)
        format_error = TRUE;
    else if (i >= 0)
        *str = master[i];
    else
        *str = NULL;

    return(READSTAT);
}

int
rs_write_str_t(FILE *savef, str_t st)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_uint(savef, st);

    return( WRITESTAT );
}

int
rs_read_str_t(FILE *inf, str_t *st)
{
    if (read_error || format_error)
        return(READSTAT);

    rs_read_uint(inf, st);

    return(READSTAT);
}

int
rs_write_coord(FILE *savef, coord c)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, c.x);
    rs_write_int(savef, c.y);
    
    return(WRITESTAT);
}

int
rs_read_coord(FILE *inf, coord *c)
{
    coord in;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf,&in.x);
    rs_read_int(inf,&in.y);

    if (READSTAT == 0) 
    {
        c->x = in.x;
        c->y = in.y;
    }

    return(READSTAT);
}

int
rs_write_window(FILE *savef, WINDOW *win)
{
    int row,col,height,width;

    if (write_error)
        return(WRITESTAT);

    width  = getmaxx(win);
    height = getmaxy(win);

    rs_write_marker(savef,RSID_WINDOW);
    rs_write_int(savef,height);
    rs_write_int(savef,width);

    for(row=0;row<height;row++)
        for(col=0;col<width;col++)
            if (rs_write_int(savef, mvwinch(win,row,col)) != 0)
                return(WRITESTAT);

    return(WRITESTAT);
}

int
rs_read_window(FILE *inf, WINDOW *win)
{
    int row,col,maxlines,maxcols,value,width,height;
    
    if (read_error || format_error)
        return(READSTAT);

    width  = getmaxx(win);
    height = getmaxy(win);

    rs_read_marker(inf, RSID_WINDOW);

    rs_read_int(inf, &maxlines);
    rs_read_int(inf, &maxcols);
    if (READSTAT || maxlines < 0 || maxcols < 0 ||
        maxlines > MAXLINES || maxcols > MAXCOLS) {
        format_error = TRUE;
        return READSTAT;
    }

    for(row = 0; row < maxlines; row++)
        for(col = 0; col < maxcols; col++)
        {
            if (rs_read_int(inf, &value) != 0)
                return(READSTAT);

            if ((row < height) && (col < width))
                mvwaddch(win,row,col,value);
        }
        
    return(READSTAT);
}

/******************************************************************************/

void *
get_list_item(THING *l, int i)
{
    int count;

    for(count = 0; l != NULL; count++, l = l->l_next)
        if (count == i)
            return(l);
    
    return(NULL);
}

int
find_list_ptr(THING *l, void *ptr)
{
    int count;

    for(count = 0; l != NULL; count++, l = l->l_next)
        if (l == ptr)
            return(count);
    
    return(-1);
}

int
list_size(THING *l)
{
    int count;
    
    for(count = 0; l != NULL; count++, l = l->l_next)
        ;
    
    return(count);
}

/******************************************************************************/

int
rs_write_stats(FILE *savef, struct stats *s)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_STATS);
    rs_write_str_t(savef, s->s_str);
    rs_write_int(savef, s->s_exp);
    rs_write_int(savef, s->s_lvl);
    rs_write_int(savef, s->s_arm);
    rs_write_int(savef, s->s_hpt);
    rs_write_chars(savef, s->s_dmg, sizeof(s->s_dmg));
    rs_write_int(savef,s->s_maxhp);

    return(WRITESTAT);
}

int
rs_read_stats(FILE *inf, struct stats *s)
{
    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_STATS);
    rs_read_str_t(inf,&s->s_str);
    rs_read_int(inf,&s->s_exp);
    rs_read_int(inf,&s->s_lvl);
    rs_read_int(inf,&s->s_arm);
    rs_read_int(inf,&s->s_hpt);
    rs_read_chars(inf,s->s_dmg,sizeof(s->s_dmg));
    rs_read_int(inf,&s->s_maxhp);
    if (!READSTAT && memchr(s->s_dmg, '\0', sizeof s->s_dmg) == NULL)
        format_error = TRUE;

    return(READSTAT);
}

int
rs_write_stone_index(FILE *savef, STONE master[], int max, const char *str)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < max; i++)
        if (str == master[i].st_name)
        {
            rs_write_int(savef,i);
            return(WRITESTAT);
        }

    rs_write_int(savef,-1);

    return(WRITESTAT);
}

int
rs_read_stone_index(FILE *inf, STONE master[], int maxindex, char **str)
{
    int i = 0;

    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf,&i)) return READSTAT;
    if (i < -1 || i >= maxindex)
        format_error = TRUE;
    else if (i >= 0)
        *str = master[i].st_name;
    else
        *str = NULL;

    return(READSTAT);
}

int
rs_write_scrolls(FILE *savef)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < MAXSCROLLS; i++)
        rs_write_string(savef, s_names[i]);

    return(WRITESTAT);
}

int
rs_read_scrolls(FILE *inf)
{
    int i;

    if (read_error || format_error)
        return(READSTAT);

    for(i = 0; i < MAXSCROLLS; i++)
        rs_read_new_string(inf, &s_names[i]);

    return(READSTAT);
}

int
rs_write_potions(FILE *savef)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < MAXPOTIONS; i++)
        rs_write_string_index(savef, rainbow, cNCOLORS, p_colors[i]);

    return(WRITESTAT);
}

int
rs_read_potions(FILE *inf)
{
    int i;

    if (read_error || format_error)
        return(READSTAT);

    for(i = 0; i < MAXPOTIONS; i++)
        rs_read_string_index(inf, rainbow, cNCOLORS, &p_colors[i]);

    return(READSTAT);
}

int
rs_write_rings(FILE *savef)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < MAXRINGS; i++)
        rs_write_stone_index(savef, stones, cNSTONES, r_stones[i]);

    return(WRITESTAT);
}

int
rs_read_rings(FILE *inf)
{
    int i;

    if (read_error || format_error)
        return(READSTAT);

    for(i = 0; i < MAXRINGS; i++)
        rs_read_stone_index(inf, stones, cNSTONES, &r_stones[i]);

    return(READSTAT);
}

int
rs_write_sticks(FILE *savef)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for (i = 0; i < MAXSTICKS; i++)
    {
        if (strcmp(ws_type[i],"staff") == 0)
        {
            rs_write_int(savef,0);
            rs_write_string_index(savef, wood, cNWOOD, ws_made[i]);
        }
        else
        {
            rs_write_int(savef,1);
            rs_write_string_index(savef, metal, cNMETAL, ws_made[i]);
        }
    }
 
    return(WRITESTAT);
}
        
int
rs_read_sticks(FILE *inf)
{
    int i = 0, list = 0;

    if (read_error || format_error)
        return(READSTAT);

    for(i = 0; i < MAXSTICKS; i++)
    { 
        rs_read_int(inf,&list);

        if (list == 0)
        {
            rs_read_string_index(inf, wood, cNWOOD, &ws_made[i]);
            ws_type[i] = "staff";
        }
        else if (list == 1)
        {
            rs_read_string_index(inf, metal, cNMETAL, &ws_made[i]);
            ws_type[i] = "wand";
        }
        else {
            format_error = TRUE;
            return READSTAT;
        }
    }

    return(READSTAT);
}

int
rs_write_daemons(FILE *savef, struct delayed_action *d_list, int count)
{
    int i = 0;
    int func = 0;
        
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_DAEMONS);
    rs_write_int(savef, count);
        
    for(i = 0; i < count; i++)
    {
        if (d_list[i].d_func == rollwand)
            func = 1;
        else if (d_list[i].d_func == doctor)
            func = 2;
        else if (d_list[i].d_func == stomach)
            func = 3;
        else if (d_list[i].d_func == runners)
            func = 4;
        else if (d_list[i].d_func == swander)
            func = 5;
        else if (d_list[i].d_func == nohaste)
            func = 6;
        else if (d_list[i].d_func == unconfuse)
            func = 7;
        else if (d_list[i].d_func == unsee)
            func = 8;
        else if (d_list[i].d_func == sight)
            func = 9;
        else if (d_list[i].d_func == come_down)
            func = 10;
        else if (d_list[i].d_func == visuals)
            func = 11;
        else if (d_list[i].d_func == land)
            func = 12;
        else if (d_list[i].d_func == (void(*)())turn_see)
            func = 13;
        else if (d_list[i].d_func == NULL)
            func = 0;
        else {
            write_error = TRUE;
            return WRITESTAT;
        }
        if (d_list[i].d_type < 0 || d_list[i].d_type > 2 ||
            (d_list[i].d_type != 0 && func == 0) || d_list[i].d_time < -1) {
            write_error = TRUE;
            return WRITESTAT;
        }

        rs_write_int(savef, d_list[i].d_type);
        rs_write_int(savef, func);
        rs_write_int(savef, d_list[i].d_arg);
        rs_write_int(savef, d_list[i].d_time);
    }
    
    return(WRITESTAT);
}       

int
rs_read_daemons(FILE *inf, struct delayed_action *d_list, int count)
{
    int i = 0;
    int func = 0;
    int value = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_DAEMONS);
    rs_read_int(inf, &value);

    if (READSTAT || value != count) {
        format_error = TRUE;
        return READSTAT;
    }

    for(i=0; i < count; i++)
    {
        func = 0;
        rs_read_int(inf, &d_list[i].d_type);
        rs_read_int(inf, &func);
        rs_read_int(inf, &d_list[i].d_arg);
        rs_read_int(inf, &d_list[i].d_time);
        if (READSTAT) return READSTAT;
        if (d_list[i].d_type < 0 || d_list[i].d_type > 2 ||
            d_list[i].d_time < -1) {
            format_error = TRUE;
            return READSTAT;
        }
                    
        switch(func)
        {
            case 1: d_list[i].d_func = rollwand;
                    break;
            case 2: d_list[i].d_func = doctor;
                    break;
            case 3: d_list[i].d_func = stomach;
                    break;
            case 4: d_list[i].d_func = runners;
                    break;
            case 5: d_list[i].d_func = swander;
                    break;
            case 6: d_list[i].d_func = nohaste;
                    break;
            case 7: d_list[i].d_func = unconfuse;
                    break;
            case 8: d_list[i].d_func = unsee;
                    break;
            case 9: d_list[i].d_func = sight;
                    break;
            case 10:d_list[i].d_func = come_down;
                    break;
            case 11:d_list[i].d_func = visuals;
                    break;
            case 12:d_list[i].d_func = land;
                    break;
            case 13:d_list[i].d_func = (void(*)())turn_see;
                    break;
            case 0: d_list[i].d_func = NULL;
                    if (d_list[i].d_type != 0) format_error = TRUE;
                    d_list[i].d_arg = d_list[i].d_time = 0;
                    break;
            default:format_error = TRUE;
                    return READSTAT;
        }
    }
    
    return(READSTAT);
}       
        
int
rs_write_obj_info(FILE *savef, struct obj_info *i, int count)
{
    int n;
    
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_MAGICITEMS);
    rs_write_int(savef, count);

    for(n = 0; n < count; n++)
    {
        /* mi_name is constant, defined at compile time in all cases */
        rs_write_int(savef,i[n].oi_prob);
        rs_write_int(savef,i[n].oi_worth);
        rs_write_string(savef,i[n].oi_guess);
        rs_write_boolean(savef,i[n].oi_know);
    }
    
    return(WRITESTAT);
}

int
rs_read_obj_info(FILE *inf, struct obj_info *mi, int count)
{
    int n = 0;
    int value = 0;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_MAGICITEMS);

    rs_read_int(inf, &value);

    if (READSTAT || value != count) {
        format_error = TRUE;
        return READSTAT;
    }

    for(n = 0; n < value; n++)
    {
        /* mi_name is const, defined at compile time in all cases */
        rs_read_int(inf,&mi[n].oi_prob);
        rs_read_int(inf,&mi[n].oi_worth);
        rs_read_new_string(inf,&mi[n].oi_guess);
        rs_read_boolean(inf,&mi[n].oi_know);
    }
    
    return(READSTAT);
}

int
rs_write_room(FILE *savef, struct room *r)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_coord(savef, r->r_pos);
    rs_write_coord(savef, r->r_max);
    rs_write_coord(savef, r->r_gold);
    rs_write_int(savef,   r->r_goldval);
    rs_write_short(savef, r->r_flags);
    rs_write_int(savef, r->r_nexits);
    rs_write_coord(savef, r->r_exit[0]);
    rs_write_coord(savef, r->r_exit[1]);
    rs_write_coord(savef, r->r_exit[2]);
    rs_write_coord(savef, r->r_exit[3]);
    rs_write_coord(savef, r->r_exit[4]);
    rs_write_coord(savef, r->r_exit[5]);
    rs_write_coord(savef, r->r_exit[6]);
    rs_write_coord(savef, r->r_exit[7]);
    rs_write_coord(savef, r->r_exit[8]);
    rs_write_coord(savef, r->r_exit[9]);
    rs_write_coord(savef, r->r_exit[10]);
    rs_write_coord(savef, r->r_exit[11]);
    
    return(WRITESTAT);
}

int
rs_read_room(FILE *inf, struct room *r)
{
    if (read_error || format_error)
        return(READSTAT);

    rs_read_coord(inf,&r->r_pos);
    rs_read_coord(inf,&r->r_max);
    rs_read_coord(inf,&r->r_gold);
    rs_read_int(inf,&r->r_goldval);
    rs_read_short(inf,&r->r_flags);
    rs_read_int(inf,&r->r_nexits);
    rs_read_coord(inf,&r->r_exit[0]);
    rs_read_coord(inf,&r->r_exit[1]);
    rs_read_coord(inf,&r->r_exit[2]);
    rs_read_coord(inf,&r->r_exit[3]);
    rs_read_coord(inf,&r->r_exit[4]);
    rs_read_coord(inf,&r->r_exit[5]);
    rs_read_coord(inf,&r->r_exit[6]);
    rs_read_coord(inf,&r->r_exit[7]);
    rs_read_coord(inf,&r->r_exit[8]);
    rs_read_coord(inf,&r->r_exit[9]);
    rs_read_coord(inf,&r->r_exit[10]);
    rs_read_coord(inf,&r->r_exit[11]);
    if (!READSTAT && (r->r_nexits < 0 || r->r_nexits > 12))
        format_error = TRUE;

    return(READSTAT);
}

int
rs_write_rooms(FILE *savef, struct room r[], int count)
{
    int n = 0;

    if (write_error)
        return(WRITESTAT);

    rs_write_int(savef, count);
    
    for(n = 0; n < count; n++)
        rs_write_room(savef, &r[n]);
    
    return(WRITESTAT);
}

int
rs_read_rooms(FILE *inf, struct room *r, int count)
{
    int value = 0, n = 0;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_int(inf,&value);

    if (READSTAT || value != count) {
        format_error = TRUE;
        return READSTAT;
    }

    for(n = 0; n < value; n++)
        rs_read_room(inf,&r[n]);

    return(READSTAT);
}

int
rs_write_room_reference(FILE *savef, struct room *rp)
{
    int i, room = -1;
    
    if (write_error)
        return(WRITESTAT);

    for (i = 0; i < MAXROOMS; i++)
        if (&rooms[i] == rp)
            room = i;
    if (rs_web_mode) {
        for (i = 0; i < MAXPASS; i++)
            if (&passages[i] == rp) room = MAXROOMS + i;
        if (rp != NULL && room == -1) {
            write_error = TRUE;
            return WRITESTAT;
        }
    }

    rs_write_int(savef, room);

    return(WRITESTAT);
}

int
rs_read_room_reference(FILE *inf, struct room **rp)
{
    int i = -1;
    
    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf, &i)) return READSTAT;
    if (i == -1) *rp = NULL;
    else if (i >= 0 && i < MAXROOMS) *rp = &rooms[i];
    else if (rs_web_mode && i >= MAXROOMS && i < MAXROOMS + MAXPASS)
        *rp = &passages[i - MAXROOMS];
    else format_error = TRUE;
            
    return(READSTAT);
}

int
rs_write_monsters(FILE *savef, struct monster *m, int count)
{
    int n;
    
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_MONSTERS);
    rs_write_int(savef, count);

    for(n=0;n<count;n++)
        rs_write_stats(savef, &m[n].m_stats);
    
    return(WRITESTAT);
}

int
rs_read_monsters(FILE *inf, struct monster *m, int count)
{
    int value = 0, n = 0;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_MONSTERS);

    rs_read_int(inf, &value);

    if (value != count)
        format_error = TRUE;

    for(n = 0; n < count; n++)
        rs_read_stats(inf, &m[n].m_stats);
    
    return(READSTAT);
}

int
rs_write_object(FILE *savef, THING *o)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_OBJECT);
    rs_write_int(savef, o->_o._o_type); 
    rs_write_coord(savef, o->_o._o_pos); 
    rs_write_int(savef, o->_o._o_launch);
    rs_write_char(savef, o->_o._o_packch);
    rs_write_chars(savef, o->_o._o_damage, sizeof(o->_o._o_damage));
    rs_write_chars(savef, o->_o._o_hurldmg, sizeof(o->_o._o_hurldmg));
    rs_write_int(savef, o->_o._o_count);
    rs_write_int(savef, o->_o._o_which);
    rs_write_int(savef, o->_o._o_hplus);
    rs_write_int(savef, o->_o._o_dplus);
    rs_write_int(savef, o->_o._o_arm);
    rs_write_int(savef, o->_o._o_flags);
    rs_write_int(savef, o->_o._o_group);
    rs_write_string(savef, o->_o._o_label);
    return(WRITESTAT);
}

int
rs_read_object(FILE *inf, THING *o)
{
    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_OBJECT);
    rs_read_int(inf, &o->_o._o_type);
    rs_read_coord(inf, &o->_o._o_pos);
    rs_read_int(inf, &o->_o._o_launch);
    rs_read_char(inf, &o->_o._o_packch);
    rs_read_chars(inf, o->_o._o_damage, sizeof(o->_o._o_damage));
    rs_read_chars(inf, o->_o._o_hurldmg, sizeof(o->_o._o_hurldmg));
    rs_read_int(inf, &o->_o._o_count);
    rs_read_int(inf, &o->_o._o_which);
    rs_read_int(inf, &o->_o._o_hplus);
    rs_read_int(inf, &o->_o._o_dplus);
    rs_read_int(inf, &o->_o._o_arm);
    rs_read_int(inf, &o->_o._o_flags);
    rs_read_int(inf, &o->_o._o_group);
    rs_read_new_string(inf, &o->_o._o_label);
    if (!READSTAT &&
        (memchr(o->o_damage, '\0', sizeof o->o_damage) == NULL ||
         memchr(o->o_hurldmg, '\0', sizeof o->o_hurldmg) == NULL))
        format_error = TRUE;
    
    return(READSTAT);
}

int
rs_write_object_list(FILE *savef, THING *l)
{
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_OBJECTLIST);
    rs_write_int(savef, list_size(l));

    for( ;l != NULL; l = l->l_next)
        rs_write_object(savef, l);
    
    return(WRITESTAT);
}

int
rs_read_object_list(FILE *inf, THING **list)
{
    int i = 0, cnt = 0;
    THING *l = NULL, *previous = NULL, *head = NULL;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_OBJECTLIST);
    rs_read_int(inf, &cnt);
    if (READSTAT || cnt < 0 || cnt > RS_MAX_NODES) {
        format_error = TRUE;
        return READSTAT;
    }

    for (i = 0; i < cnt; i++) 
    {
        l = rs_allocate(sizeof(THING));
        if (l == NULL) return READSTAT;

        l->l_prev = previous;

        if (previous != NULL)
            previous->l_next = l;

        rs_read_object(inf,l);
        if (READSTAT) return READSTAT;

        if (previous == NULL)
            head = l;

        previous = l;
    }
            
    if (l != NULL)
        l->l_next = NULL;
    
    *list = head;

    return(READSTAT);
}

int
rs_write_object_reference(FILE *savef, THING *list, THING *item)
{
    int i;
    
    if (write_error)
        return(WRITESTAT);

    i = find_list_ptr(list, item);
    if (rs_web_mode && item != NULL && i == -1) {
        write_error = TRUE;
        return WRITESTAT;
    }

    rs_write_int(savef, i);

    return(WRITESTAT);
}

int
rs_read_object_reference(FILE *inf, THING *list, THING **item)
{
    int i = -1;
    
    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf, &i)) return READSTAT;
    if (i == -1) *item = NULL;
    else if (i < -1 || (*item = get_list_item(list,i)) == NULL)
        format_error = TRUE;
            
    return(READSTAT);
}

int
find_room_coord(struct room *rmlist, coord *c, int n)
{
    int i = 0;
    
    for(i = 0; i < n; i++)
        if(&rmlist[i].r_gold == c)
            return(i);
    
    return(-1);
}

int
find_thing_coord(THING *monlist, coord *c)
{
    THING *mitem;
    THING *tp;
    int i = 0;

    for(mitem = monlist; mitem != NULL; mitem = mitem->l_next)
    {
        tp = mitem;

        if (c == &tp->t_pos)
            return(i);

        i++;
    }

    return(-1);
}

int
find_object_coord(THING *objlist, coord *c)
{
    THING *oitem;
    THING *obj;
    int i = 0;

    for(oitem = objlist; oitem != NULL; oitem = oitem->l_next)
    {
        obj = oitem;

        if (c == &obj->o_pos)
            return(i);

        i++;
    }

    return(-1);
}

int
rs_write_thing(FILE *savef, THING *t)
{
    int i = -1;
    
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_THING);

    if (t == NULL)
    {
        rs_write_int(savef, 0);
        return(WRITESTAT);
    }
    
    rs_write_int(savef, 1);
    rs_write_coord(savef, t->_t._t_pos);
    rs_write_boolean(savef, t->_t._t_turn);
    rs_write_char(savef, t->_t._t_type);
    rs_write_char(savef, t->_t._t_disguise);
    rs_write_char(savef, t->_t._t_oldch);

    /* 
        t_dest can be:
        0,0: NULL
        0,1: location of hero
        1,i: location of a thing (monster)
        2,i: location of an object
        3,i: location of gold in a room

        We need to remember what we are chasing rather than 
        the current location of what we are chasing.
    */

    if (t->t_dest == &hero)
    {
        rs_write_int(savef,0);
        rs_write_int(savef,1);
    }
    else if (t->t_dest != NULL)
    {
        i = find_thing_coord(mlist, t->t_dest);
            
        if (i >=0 )
        {
            rs_write_int(savef,1);
            rs_write_int(savef,i);
        }
        else
        {
            i = find_object_coord(lvl_obj, t->t_dest);
            
            if (i >= 0)
            {
                rs_write_int(savef,2);
                rs_write_int(savef,i);
            }
            else
            {
                i = find_room_coord(rooms, t->t_dest, MAXROOMS);
        
                if (i >= 0) 
                {
                    rs_write_int(savef,3);
                    rs_write_int(savef,i);
                }
                else 
                {
                    if (rs_web_mode) {
                        write_error = TRUE;
                        return WRITESTAT;
                    }
                    rs_write_int(savef, 0);
                    rs_write_int(savef,1); /* chase the hero anyway */
                }
            }
        }
    }
    else
    {
        rs_write_int(savef,0);
        rs_write_int(savef,0);
    }
    
    rs_write_short(savef, t->_t._t_flags);
    rs_write_stats(savef, &t->_t._t_stats);
    rs_write_room_reference(savef, t->_t._t_room);
    rs_write_object_list(savef, t->_t._t_pack);
    
    return(WRITESTAT);
}

int
rs_read_thing(FILE *inf, THING *t)
{
    int listid = 0, index = -1;
    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_THING);

    rs_read_int(inf, &index);
    if (READSTAT) return READSTAT;
    if (index == 0 && !rs_web_mode)
        return(READSTAT);
    if (index != 1) { format_error = TRUE; return READSTAT; }

    rs_read_coord(inf,&t->_t._t_pos);
    rs_read_boolean(inf,&t->_t._t_turn);
    rs_read_char(inf,&t->_t._t_type);
    rs_read_char(inf,&t->_t._t_disguise);
    rs_read_char(inf,&t->_t._t_oldch);
            
    /* 
        t_dest can be (listid,index):
        0,0: NULL
        0,1: location of hero
        1,i: location of a thing (monster)
        2,i: location of an object
        3,i: location of gold in a room

        We need to remember what we are chasing rather than 
        the current location of what we are chasing.
    */
            
    rs_read_int(inf, &listid);
    rs_read_int(inf, &index);
    t->_t._t_reserved = -1;
    t->_t._t_dest = NULL;
    if (READSTAT) return READSTAT;

    if (listid == 0) /* hero or NULL */
    {
        if (index == 1)
            t->_t._t_dest = &hero;
        else if (index == 0)
            t->_t._t_dest = NULL;
        else format_error = TRUE;
    }
    else if (listid == 1) /* monster/thing */
    {
        if (index < 0 || index >= RS_MAX_NODES) format_error = TRUE;
        else t->_t._t_reserved = index;
    }
    else if (listid == 2) /* object */
    {
        /* Both player and monster targets are fixed only after ALL lists load.
         * A negative reserved ID distinguishes an object from a monster. */
        if (index < 0 || index >= RS_MAX_NODES) format_error = TRUE;
        else t->_t._t_reserved = -2 - index;
    }
    else if (listid == 3) /* gold */
    {
        if (index < 0 || index >= MAXROOMS) format_error = TRUE;
        else t->_t._t_dest = &rooms[index].r_gold;
    }
    else
        format_error = TRUE;
            
    rs_read_short(inf,&t->_t._t_flags);
    rs_read_stats(inf,&t->_t._t_stats);
    rs_read_room_reference(inf, &t->_t._t_room);
    rs_read_object_list(inf,&t->_t._t_pack);
    
    return(READSTAT);
}

void
rs_fix_thing(THING *t)
{
    THING *item;
    THING *tp;

    if (READSTAT || t->t_reserved == -1)
        return;
    if (t->t_reserved < -1) {
        item = get_list_item(lvl_obj, -2 - t->t_reserved);
        if (item == NULL) format_error = TRUE;
        else t->t_dest = &item->o_pos;
        t->t_reserved = -1;
        return;
    }
    item = get_list_item(mlist,t->t_reserved);

    if (item != NULL)
    {
        tp = item;
        t->t_dest = &tp->t_pos;
    }
    else format_error = TRUE;
    t->t_reserved = -1;
}

int
rs_write_thing_list(FILE *savef, THING *l)
{
    int cnt = 0;
    
    if (write_error)
        return(WRITESTAT);

    rs_write_marker(savef, RSID_MONSTERLIST);

    cnt = list_size(l);

    rs_write_int(savef, cnt);

    if (cnt < 1)
        return(WRITESTAT);

    while (l != NULL) {
        rs_write_thing(savef, l);
        l = l->l_next;
    }
    
    return(WRITESTAT);
}

int
rs_read_thing_list(FILE *inf, THING **list)
{
    int i = 0, cnt = 0;
    THING *l = NULL, *previous = NULL, *head = NULL;

    if (read_error || format_error)
        return(READSTAT);

    rs_read_marker(inf, RSID_MONSTERLIST);

    rs_read_int(inf, &cnt);
    if (READSTAT || cnt < 0 || cnt > RS_MAX_NODES) {
        format_error = TRUE;
        return READSTAT;
    }

    for (i = 0; i < cnt; i++) 
    {
        l = rs_allocate(sizeof *l);
        if (l == NULL) return READSTAT;

        l->l_prev = previous;
            
        if (previous != NULL)
            previous->l_next = l;

        rs_read_thing(inf,l);
        if (READSTAT) return READSTAT;

        if (previous == NULL)
            head = l;

        previous = l;
    }
        
    if (l != NULL)
        l->l_next = NULL;

    *list = head;
    
    return(READSTAT);
}

void
rs_fix_thing_list(THING *list)
{
    THING *item;

    for(item = list; item != NULL; item = item->l_next)
        rs_fix_thing(item);
}

int
rs_write_thing_reference(FILE *savef, THING *list, THING *item)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    if (item == NULL)
        rs_write_int(savef,-1);
    else
    {
        i = find_list_ptr(list, item);
        if (rs_web_mode && i == -1) {
            write_error = TRUE;
            return WRITESTAT;
        }
        rs_write_int(savef, i);
    }

    return(WRITESTAT);
}

int
rs_read_thing_reference(FILE *inf, THING *list, THING **item)
{
    int i = -1;
    
    if (read_error || format_error)
        return(READSTAT);

    if (rs_read_int(inf, &i)) return READSTAT;

    if (i == -1)
        *item = NULL;
    else if (i < -1 || (*item = get_list_item(list,i)) == NULL)
        format_error = TRUE;

    return(READSTAT);
}

int
rs_write_thing_references(FILE *savef, THING *list, THING *items[], int count)
{
    int i;

    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < count; i++)
        rs_write_thing_reference(savef,list,items[i]);

    return(WRITESTAT);
}

int
rs_read_thing_references(FILE *inf, THING *list, THING *items[], int count)
{
    int i;

    if (read_error || format_error)
        return(READSTAT);

    for(i = 0; i < count; i++)
        rs_read_thing_reference(inf,list,&items[i]);

    return(READSTAT);
}

int 
rs_write_places(FILE *savef, PLACE *places, int count)
{
    int i = 0;
    
    if (write_error)
        return(WRITESTAT);

    for(i = 0; i < count; i++) 
    {
        rs_write_char(savef, places[i].p_ch);
        rs_write_char(savef, places[i].p_flags);
        rs_write_thing_reference(savef, mlist, places[i].p_monst);
    }

    return(WRITESTAT);
}

int 
rs_read_places(FILE *inf, PLACE *places, int count)
{
    int i = 0;
    
    if (read_error || format_error)
        return(READSTAT);

    for(i = 0; i < count; i++) 
    {
        rs_read_char(inf,&places[i].p_ch);
        rs_read_char(inf,&places[i].p_flags);
        rs_read_thing_reference(inf, mlist, &places[i].p_monst);
    }

    return(READSTAT);
}

int
rs_save_file(FILE *savef)
{
    rs_reset();
    if (write_error)
        return(WRITESTAT);

    rs_write_boolean(savef, after);                 /* 1  */    /* extern.c */
    rs_write_boolean(savef, again);                 /* 2  */
    rs_write_int(savef, noscore);	                /* 3  */
    rs_write_boolean(savef, seenstairs);            /* 4  */
    rs_write_boolean(savef, amulet);                /* 5  */
    rs_write_boolean(savef, door_stop);             /* 6  */
    rs_write_boolean(savef, fight_flush);           /* 7  */
    rs_write_boolean(savef, firstmove);             /* 8  */
    rs_write_boolean(savef, got_ltc);               /* 9  */
    rs_write_boolean(savef, has_hit);               /* 10 */
    rs_write_boolean(savef, in_shell);              /* 11 */
    rs_write_boolean(savef, inv_describe);          /* 12 */
    rs_write_boolean(savef, jump);                  /* 13 */
    rs_write_boolean(savef, kamikaze);              /* 14 */
    rs_write_boolean(savef, lower_msg);             /* 15 */
    rs_write_boolean(savef, move_on);               /* 16 */
    rs_write_boolean(savef, msg_esc);               /* 17 */
    rs_write_boolean(savef, passgo);                /* 18 */
    rs_write_boolean(savef, playing);               /* 19 */
    rs_write_boolean(savef, q_comm);                /* 20 */
    rs_write_boolean(savef, running);               /* 21 */
    rs_write_boolean(savef, save_msg);              /* 22 */
    rs_write_boolean(savef, see_floor);             /* 23 */
    rs_write_boolean(savef, stat_msg);              /* 24 */
    rs_write_boolean(savef, terse);                 /* 25 */
    rs_write_boolean(savef, to_death);              /* 26 */
    rs_write_boolean(savef, tombstone);             /* 27 */
#ifdef MASTER
    rs_write_int(savef, wizard);                    /* 28 */
#else
    rs_write_int(savef, 0);                         /* 28 */
#endif
    rs_write_booleans(savef, pack_used, 26);        /* 29 */
    rs_write_char(savef, dir_ch);
    if (!rs_web_mode) rs_write_chars(savef, file_name, MAXSTR);
    rs_write_chars(savef, huh, MAXSTR);
    rs_write_potions(savef);
    rs_write_chars(savef,prbuf,2*MAXSTR);
    rs_write_rings(savef);
    if (!rs_web_mode) rs_write_string(savef,release);
    rs_write_char(savef, runch);
    rs_write_scrolls(savef);
    rs_write_char(savef, take);
    rs_write_chars(savef, whoami, MAXSTR);
    rs_write_sticks(savef);
    if (!rs_web_mode) rs_write_int(savef,orig_dsusp);
    rs_write_chars(savef, fruit, MAXSTR);
    if (!rs_web_mode) {
        rs_write_chars(savef, home, MAXSTR);
        rs_write_strings(savef,inv_t_name,3);
    }
    rs_write_char(savef,l_last_comm);
    rs_write_char(savef,l_last_dir);
    rs_write_char(savef,last_comm);
    rs_write_char(savef,last_dir);
    if (!rs_web_mode) rs_write_strings(savef,tr_name,8);
    rs_write_int(savef,n_objs);
    rs_write_int(savef, ntraps);
    rs_write_int(savef, hungry_state);
    rs_write_int(savef, inpack);
    rs_write_int(savef, inv_type);
    rs_write_int(savef, level);
    rs_write_int(savef, max_level);
    rs_write_int(savef, mpos);
    rs_write_int(savef, no_food);
    rs_write_ints(savef,a_class,MAXARMORS);
    rs_write_int(savef, count);
    rs_write_int(savef, food_left);
    rs_write_int(savef, lastscore);
    rs_write_int(savef, no_command);
    rs_write_int(savef, no_move);
    rs_write_int(savef, purse);
    rs_write_int(savef, quiet);
    rs_write_int(savef, vf_hit);
    rs_write_int(savef, dnum);
    rs_write_int(savef, seed);
    rs_write_ints(savef, e_levels, 21);
    rs_write_coord(savef, delta);
    rs_write_coord(savef, oldpos);
    rs_write_coord(savef, stairs);

    rs_write_thing(savef, &player);                     
    rs_write_object_reference(savef, player.t_pack, cur_armor);
    rs_write_object_reference(savef, player.t_pack, cur_ring[0]);
    rs_write_object_reference(savef, player.t_pack, cur_ring[1]); 
    rs_write_object_reference(savef, player.t_pack, cur_weapon); 
    rs_write_object_reference(savef, player.t_pack, l_last_pick); 
    rs_write_object_reference(savef, player.t_pack, last_pick); 
    
    rs_write_object_list(savef, lvl_obj);               
    rs_write_thing_list(savef, mlist);                

    rs_write_places(savef,places,MAXLINES*MAXCOLS);

    rs_write_stats(savef,&max_stats); 
    rs_write_rooms(savef, rooms, MAXROOMS);             
    rs_write_room_reference(savef, oldrp);              
    rs_write_rooms(savef, passages, MAXPASS);

    rs_write_monsters(savef,monsters,26);               
    rs_write_obj_info(savef, things,   NUMTHINGS);   
    rs_write_obj_info(savef, arm_info,  MAXARMORS);  
    rs_write_obj_info(savef, pot_info,  MAXPOTIONS);  
    rs_write_obj_info(savef, ring_info,  MAXRINGS);    
    rs_write_obj_info(savef, scr_info,  MAXSCROLLS);  
    rs_write_obj_info(savef, weap_info,  MAXWEAPONS+1);  
    rs_write_obj_info(savef, ws_info, MAXSTICKS);      
    
    
    rs_write_daemons(savef, &d_list[0], 20);            /* 5.4-daemon.c */
#ifdef MASTER
    rs_write_int(savef,total);                          /* 5.4-list.c   */
#else
    rs_write_int(savef, 0);
#endif
    rs_write_int(savef,between);                        /* 5.4-daemons.c*/
    rs_write_coord(savef, nh);                          /* 5.4-move.c    */
    rs_write_int(savef, group);                         /* 5.4-weapons.c */

    if (!rs_web_mode) rs_write_window(savef,stdscr);
    else rs_write_int(savef, max_hit);

    return(WRITESTAT);
}

int
rs_restore_file(FILE *inf)
{
    int dummyint;
    rs_reset();

    if (read_error || format_error)
        return(READSTAT);

    rs_read_boolean(inf, &after);               /* 1  */    /* extern.c */
    rs_read_boolean(inf, &again);               /* 2  */
    rs_read_int(inf, &noscore);                 /* 3  */
    rs_read_boolean(inf, &seenstairs);          /* 4  */
    rs_read_boolean(inf, &amulet);              /* 5  */
    rs_read_boolean(inf, &door_stop);           /* 6  */
    rs_read_boolean(inf, &fight_flush);         /* 7  */
    rs_read_boolean(inf, &firstmove);           /* 8  */
    rs_read_boolean(inf, &got_ltc);             /* 9  */
    rs_read_boolean(inf, &has_hit);             /* 10 */
    rs_read_boolean(inf, &in_shell);            /* 11 */
    rs_read_boolean(inf, &inv_describe);        /* 12 */
    rs_read_boolean(inf, &jump);                /* 13 */
    rs_read_boolean(inf, &kamikaze);            /* 14 */
    rs_read_boolean(inf, &lower_msg);           /* 15 */
    rs_read_boolean(inf, &move_on);             /* 16 */
    rs_read_boolean(inf, &msg_esc);             /* 17 */
    rs_read_boolean(inf, &passgo);              /* 18 */
    rs_read_boolean(inf, &playing);             /* 19 */
    rs_read_boolean(inf, &q_comm);              /* 20 */
    rs_read_boolean(inf, &running);             /* 21 */
    rs_read_boolean(inf, &save_msg);            /* 22 */
    rs_read_boolean(inf, &see_floor);           /* 23 */
    rs_read_boolean(inf, &stat_msg);            /* 24 */
    rs_read_boolean(inf, &terse);               /* 25 */
    rs_read_boolean(inf, &to_death);            /* 26 */
    rs_read_boolean(inf, &tombstone);           /* 27 */
#ifdef MASTER
    rs_read_int(inf, &wizard);                  /* 28 */
#else
    rs_read_int(inf, &dummyint);                /* 28 */
#endif
    rs_read_booleans(inf, pack_used, 26);       /* 29 */
    rs_read_char(inf, &dir_ch);
    if (!rs_web_mode) rs_read_chars(inf, file_name, MAXSTR);
    rs_read_chars(inf, huh, MAXSTR);
    rs_read_potions(inf);
    rs_read_chars(inf, prbuf, 2*MAXSTR);
    rs_read_rings(inf);
    if (!rs_web_mode) rs_read_new_string(inf,&release);
    rs_read_char(inf, &runch);
    rs_read_scrolls(inf);
    rs_read_char(inf, &take);
    rs_read_chars(inf, whoami, MAXSTR);
    rs_read_sticks(inf);
    if (!rs_web_mode) rs_read_int(inf,&orig_dsusp);
    rs_read_chars(inf, fruit, MAXSTR);
    if (!rs_web_mode) {
        rs_read_chars(inf, home, MAXSTR);
        rs_read_new_strings(inf,inv_t_name,3);
    }
    rs_read_char(inf, &l_last_comm);
    rs_read_char(inf, &l_last_dir);
    rs_read_char(inf, &last_comm);
    rs_read_char(inf, &last_dir);
    if (!rs_web_mode) rs_read_new_strings(inf,tr_name,8);
    rs_read_int(inf, &n_objs);
    rs_read_int(inf, &ntraps);
    rs_read_int(inf, &hungry_state);
    rs_read_int(inf, &inpack);
    rs_read_int(inf, &inv_type);
    rs_read_int(inf, &level);
    rs_read_int(inf, &max_level);
    rs_read_int(inf, &mpos);
    rs_read_int(inf, &no_food);
    rs_read_ints(inf,a_class,MAXARMORS);
    rs_read_int(inf, &count);
    rs_read_int(inf, &food_left);
    rs_read_int(inf, &lastscore);
    rs_read_int(inf, &no_command);
    rs_read_int(inf, &no_move);
    rs_read_int(inf, &purse);
    rs_read_int(inf, &quiet);
    rs_read_int(inf, &vf_hit);
    rs_read_int(inf, &dnum);
    rs_read_int(inf, &seed);
    rs_read_ints(inf,e_levels,21);
    rs_read_coord(inf, &delta);
    rs_read_coord(inf, &oldpos);
    rs_read_coord(inf, &stairs);

    rs_read_thing(inf, &player); 
    rs_read_object_reference(inf, player.t_pack, &cur_armor);
    rs_read_object_reference(inf, player.t_pack, &cur_ring[0]);
    rs_read_object_reference(inf, player.t_pack, &cur_ring[1]);
    rs_read_object_reference(inf, player.t_pack, &cur_weapon);
    rs_read_object_reference(inf, player.t_pack, &l_last_pick);
    rs_read_object_reference(inf, player.t_pack, &last_pick);

    rs_read_object_list(inf, &lvl_obj);                 
    rs_read_thing_list(inf, &mlist);                  
    if (!READSTAT) {
        rs_fix_thing(&player);
        rs_fix_thing_list(mlist);
    }

    rs_read_places(inf,places,MAXLINES*MAXCOLS);

    rs_read_stats(inf, &max_stats);
    rs_read_rooms(inf, rooms, MAXROOMS);
    rs_read_room_reference(inf, &oldrp);
    rs_read_rooms(inf, passages, MAXPASS);

    rs_read_monsters(inf,monsters,26);                  
    rs_read_obj_info(inf, things,   NUMTHINGS);         
    rs_read_obj_info(inf, arm_info,   MAXARMORS);         
    rs_read_obj_info(inf, pot_info,  MAXPOTIONS);       
    rs_read_obj_info(inf, ring_info,  MAXRINGS);         
    rs_read_obj_info(inf, scr_info,  MAXSCROLLS);       
    rs_read_obj_info(inf, weap_info, MAXWEAPONS+1);       
    rs_read_obj_info(inf, ws_info, MAXSTICKS);       

    rs_read_daemons(inf, d_list, 20);                   /* 5.4-daemon.c     */
    rs_read_int(inf,&dummyint);  /* total */            /* 5.4-list.c    */
    rs_read_int(inf,&between);                          /* 5.4-daemons.c    */
    rs_read_coord(inf, &nh);                            /* 5.4-move.c       */
    rs_read_int(inf,&group);                            /* 5.4-weapons.c    */
    
    if (!rs_web_mode) rs_read_window(inf,stdscr);
    else rs_read_int(inf, &max_hit);

    return(READSTAT);
}

/* A transaction backs up each global touched by the schema. The old pointer
 * graph is never modified while decoding: all new nodes/strings are distinct,
 * and target references are fixed after the replacement lists are complete.
 * Thus truncation, invalid IDs, and allocation failure can roll back without
 * executing look(), a daemon, or a random-number operation. */
struct rs_global_entry { void *address; size_t size; };
#define RS_VAR(v) { &(v), sizeof(v) }
#define RS_ARRAY(v,n) { (v), sizeof((v)[0]) * (n) }
static const struct rs_global_entry rs_globals[] = {
    RS_VAR(after), RS_VAR(again), RS_VAR(noscore), RS_VAR(seenstairs),
    RS_VAR(amulet), RS_VAR(door_stop), RS_VAR(fight_flush), RS_VAR(firstmove),
    RS_VAR(got_ltc), RS_VAR(has_hit), RS_VAR(in_shell), RS_VAR(inv_describe),
    RS_VAR(jump), RS_VAR(kamikaze), RS_VAR(lower_msg), RS_VAR(move_on),
    RS_VAR(msg_esc), RS_VAR(passgo), RS_VAR(playing), RS_VAR(q_comm),
    RS_VAR(running), RS_VAR(save_msg), RS_VAR(see_floor), RS_VAR(stat_msg),
    RS_VAR(terse), RS_VAR(to_death), RS_VAR(tombstone),
#ifdef MASTER
    RS_VAR(wizard), RS_VAR(total),
#endif
    RS_ARRAY(pack_used,26), RS_VAR(dir_ch), RS_ARRAY(huh,MAXSTR),
    RS_ARRAY(prbuf,2*MAXSTR), RS_ARRAY(p_colors,MAXPOTIONS),
    RS_ARRAY(r_stones,MAXRINGS), RS_ARRAY(s_names,MAXSCROLLS), RS_VAR(runch),
    RS_VAR(take), RS_ARRAY(whoami,MAXSTR), RS_ARRAY(fruit,MAXSTR),
    RS_ARRAY(ws_type,MAXSTICKS), RS_ARRAY(ws_made,MAXSTICKS),
    RS_VAR(l_last_comm), RS_VAR(l_last_dir), RS_VAR(last_comm), RS_VAR(last_dir),
    RS_VAR(n_objs), RS_VAR(ntraps), RS_VAR(hungry_state), RS_VAR(inpack),
    RS_VAR(inv_type), RS_VAR(level), RS_VAR(max_level), RS_VAR(mpos),
    RS_VAR(no_food), RS_ARRAY(a_class,MAXARMORS), RS_VAR(count),
    RS_VAR(food_left), RS_VAR(lastscore), RS_VAR(no_command), RS_VAR(no_move),
    RS_VAR(purse), RS_VAR(quiet), RS_VAR(vf_hit), RS_VAR(dnum), RS_VAR(seed),
    RS_ARRAY(e_levels,21), RS_VAR(delta), RS_VAR(oldpos), RS_VAR(stairs),
    RS_VAR(player), RS_VAR(cur_armor), RS_ARRAY(cur_ring,2), RS_VAR(cur_weapon),
    RS_VAR(l_last_pick), RS_VAR(last_pick), RS_VAR(lvl_obj), RS_VAR(mlist),
    RS_ARRAY(places,MAXLINES*MAXCOLS), RS_VAR(max_stats),
    RS_ARRAY(rooms,MAXROOMS), RS_VAR(oldrp), RS_ARRAY(passages,MAXPASS),
    RS_ARRAY(monsters,26), RS_ARRAY(things,NUMTHINGS),
    RS_ARRAY(arm_info,MAXARMORS), RS_ARRAY(pot_info,MAXPOTIONS),
    RS_ARRAY(ring_info,MAXRINGS), RS_ARRAY(scr_info,MAXSCROLLS),
    RS_ARRAY(weap_info,MAXWEAPONS+1), RS_ARRAY(ws_info,MAXSTICKS),
    RS_ARRAY(d_list,MAXDAEMONS), RS_VAR(between), RS_VAR(nh), RS_VAR(group),
    RS_VAR(max_hit)
};
#undef RS_VAR
#undef RS_ARRAY

static uint8_t *
rs_capture_globals(void)
{
    size_t n, length = 0, offset = 0;
    uint8_t *backup;
    for (n = 0; n < sizeof rs_globals / sizeof rs_globals[0]; n++)
        length += rs_globals[n].size;
    backup = malloc(length);
    if (backup == NULL) return NULL;
    for (n = 0; n < sizeof rs_globals / sizeof rs_globals[0]; n++) {
        memcpy(backup + offset, rs_globals[n].address, rs_globals[n].size);
        offset += rs_globals[n].size;
    }
    return backup;
}

static void
rs_rollback_globals(const uint8_t *backup)
{
    size_t n, offset = 0;
    for (n = 0; n < sizeof rs_globals / sizeof rs_globals[0]; n++) {
        memcpy(rs_globals[n].address, backup + offset, rs_globals[n].size);
        offset += rs_globals[n].size;
    }
}

struct rs_info_table { struct obj_info *items; int count; };
static const struct rs_info_table rs_info_tables[] = {
    {things,NUMTHINGS}, {arm_info,MAXARMORS}, {pot_info,MAXPOTIONS},
    {ring_info,MAXRINGS}, {scr_info,MAXSCROLLS}, {weap_info,MAXWEAPONS+1},
    {ws_info,MAXSTICKS}
};
#define RS_GUESS_COUNT (NUMTHINGS+MAXARMORS+MAXPOTIONS+MAXRINGS+MAXSCROLLS+MAXWEAPONS+1+MAXSTICKS)
struct rs_old_owned {
    THING *pack_nodes, *objects, *monsters;
    uintptr_t *strings;
    size_t string_count;
};
#define RS_OLD_STRING_LIMIT (RS_MAX_NODES + MAXSCROLLS + RS_GUESS_COUNT)

static int
rs_capture_old_string(struct rs_old_owned *old, char *string)
{
    if (string == NULL) return 0;
    if (old->string_count == RS_OLD_STRING_LIMIT) return -1;
    old->strings[old->string_count++] = (uintptr_t)string;
    return 0;
}

static int
rs_capture_object_strings(struct rs_old_owned *old, THING *list, int *nodes)
{
    for (; list != NULL; list = list->l_next) {
        if (++*nodes > RS_MAX_NODES || rs_capture_old_string(old, list->o_label))
            return -1;
    }
    return 0;
}

static int
rs_capture_owned(struct rs_old_owned *old)
{
    size_t table;
    THING *monster;
    int n, nodes = 0;
    old->pack_nodes = player.t_pack;
    old->objects = lvl_obj;
    old->monsters = mlist;
    old->strings = malloc(RS_OLD_STRING_LIMIT * sizeof *old->strings);
    old->string_count = 0;
    if (old->strings == NULL) return -1;
    if (rs_capture_object_strings(old, old->pack_nodes, &nodes) ||
        rs_capture_object_strings(old, old->objects, &nodes)) return -1;
    for (monster = old->monsters; monster != NULL; monster = monster->l_next)
        if (++nodes > RS_MAX_NODES ||
            rs_capture_object_strings(old, monster->t_pack, &nodes)) return -1;
    for (n = 0; n < MAXSCROLLS; n++)
        if (rs_capture_old_string(old, s_names[n])) return -1;
    for (table = 0; table < sizeof rs_info_tables / sizeof rs_info_tables[0]; table++)
        for (n = 0; n < rs_info_tables[table].count; n++)
            if (rs_capture_old_string(old, rs_info_tables[table].items[n].oi_guess)) return -1;
    return 0;
}

static void
rs_free_objects(THING *list)
{
    THING *next;
    while (list != NULL) {
        next = list->l_next;
        free(list);
        list = next;
    }
}

static int
rs_compare_owned_strings(const void *left, const void *right)
{
    uintptr_t a = *(const uintptr_t *)left, b = *(const uintptr_t *)right;
    return (a > b) - (a < b);
}

static void
rs_release_old_owned(struct rs_old_owned *old)
{
    THING *monster = old->monsters, *next;
    size_t n;
    rs_free_objects(old->pack_nodes);
    rs_free_objects(old->objects);
    while (monster != NULL) {
        next = monster->l_next;
        rs_free_objects(monster->t_pack);
        free(monster);
        monster = next;
    }
    /* leave_pack(newobj=TRUE) historically shallow-copies o_label. A pack
     * stack and a thrown/floor object can therefore own the same allocation.
     * Free each prior string address once, across ALL prior object graphs. */
    qsort(old->strings, old->string_count, sizeof *old->strings, rs_compare_owned_strings);
    for (n = 0; n < old->string_count; n++)
        if (n == 0 || old->strings[n] != old->strings[n-1])
            free((void *)old->strings[n]);
}

static int
rs_valid_coord(coord value)
{
    return value.x >= 0 && value.x < NUMCOLS && value.y >= 0 && value.y < NUMLINES;
}

static int
rs_valid_target_coord(coord value)
{
    /* An attempted move or f/F/^ direction can point one cell off-screen. */
    return value.x >= -1 && value.x <= NUMCOLS &&
        value.y >= -1 && value.y <= NUMLINES;
}

static int
rs_valid_objects(THING *list)
{
    int limit;
    for (; list != NULL; list = list->l_next) {
        if (!rs_valid_coord(list->o_pos) || list->o_count < 0 ||
            (list->o_type != GOLD && list->o_count == 0)) return 0;
        switch (list->o_type) {
            case POTION: limit = MAXPOTIONS; break;
            case SCROLL: limit = MAXSCROLLS; break;
            case WEAPON: limit = MAXWEAPONS; break;
            case ARMOR: limit = MAXARMORS; break;
            case RING: limit = MAXRINGS; break;
            case STICK: limit = MAXSTICKS; break;
            case FOOD: limit = 2; break;
            case AMULET: case GOLD: limit = 1; break;
            default: return 0;
        }
        if (list->o_which < 0 || list->o_which >= limit) return 0;
    }
    return 1;
}

static int
rs_valid_room_bounds(const struct room *room, int passage)
{
    int n;
    if ((room->r_flags & ~(ISDARK | ISGONE | ISMAZE)) != 0 ||
        room->r_nexits < 0 || room->r_nexits > 12 ||
        !rs_valid_coord(room->r_pos) || !rs_valid_coord(room->r_gold)) return 0;
    if (passage) {
        /* passnum() changes only exits in these corridor records. */
        /* The 13th original array slot has an implicit all-zero initializer. */
        if (room->r_pos.x != 0 || room->r_pos.y != 0 ||
            room->r_max.x != 0 || room->r_max.y != 0) return 0;
    } else if (room->r_flags & ISGONE) {
        if (room->r_max.x != -NUMCOLS || room->r_max.y != -NUMLINES) return 0;
    } else if (room->r_max.x <= 0 || room->r_max.y <= 0 ||
        room->r_max.x > NUMCOLS - room->r_pos.x ||
        room->r_max.y > NUMLINES - room->r_pos.y) return 0;
    for (n = 0; n < room->r_nexits; n++)
        if (!rs_valid_coord(room->r_exit[n])) return 0;
    return 1;
}

static int
rs_valid_restored_state(void)
{
    THING *monster;
    int n;
    if (!playing || in_shell || got_ltc ||
        !rs_valid_coord(hero) || !rs_valid_coord(oldpos) ||
        !rs_valid_coord(stairs) || !rs_valid_target_coord(nh) ||
        proom == NULL || oldrp == NULL || pstats.s_str > 31 ||
        pstats.s_lvl < 1 || pstats.s_lvl > 21 || pstats.s_hpt <= 0 ||
        max_stats.s_str > 31 || level < 1 || max_level < level ||
        ntraps < 0 || ntraps > MAXTRAPS || inpack < 0 || inpack > MAXPACK ||
        inv_type < 0 || inv_type > 2 || mpos < 0 || mpos > 2 * NUMCOLS ||
        no_command < 0 || no_move < 0 || quiet < 0 ||
        /* f/F/^ keep a target coordinate here; get_dir keeps a direction. */
        !rs_valid_target_coord(delta) ||
        memchr(whoami, '\0', MAXSTR) == NULL ||
        memchr(fruit, '\0', MAXSTR) == NULL ||
        memchr(huh, '\0', MAXSTR) == NULL ||
        memchr(prbuf, '\0', 2*MAXSTR) == NULL ||
        !rs_valid_objects(player.t_pack) || !rs_valid_objects(lvl_obj)) {
#ifdef RG_SAVE_DIAGNOSTICS
        fprintf(stderr,"STATE base playing=%d shell=%d ltc=%d hero=%d,%d old=%d,%d stairs=%d,%d nh=%d,%d room=%p oldroom=%p str=%u lvl=%d hp=%d maxstr=%u level=%d maxlevel=%d traps=%d pack=%d inv=%d mpos=%d nom=%d no_move=%d quiet=%d delta=%d,%d objects=%d,%d\n",playing,in_shell,got_ltc,hero.x,hero.y,oldpos.x,oldpos.y,stairs.x,stairs.y,nh.x,nh.y,(void*)proom,(void*)oldrp,pstats.s_str,pstats.s_lvl,pstats.s_hpt,max_stats.s_str,level,max_level,ntraps,inpack,inv_type,mpos,no_command,no_move,quiet,delta.x,delta.y,rs_valid_objects(player.t_pack),rs_valid_objects(lvl_obj));
#endif
        return 0;
    }
    if (e_levels[20] != 0) return 0;
    for (n = 0; n < 20; n++)
        if (e_levels[n] <= 0 || (n > 0 && e_levels[n] <= e_levels[n-1])) return 0;
    for (n = 0; n < MAXPOTIONS; n++) if (p_colors[n] == NULL) return 0;
    for (n = 0; n < MAXRINGS; n++) if (r_stones[n] == NULL) return 0;
    for (n = 0; n < MAXSTICKS; n++)
        if (ws_made[n] == NULL || ws_type[n] == NULL) return 0;
    for (n = 0; n < MAXSCROLLS; n++) if (s_names[n] == NULL) return 0;
    for (n = 0; n < MAXROOMS; n++) if (!rs_valid_room_bounds(&rooms[n], 0)) {
#ifdef RG_SAVE_DIAGNOSTICS
        fprintf(stderr,"STATE room %d pos=%d,%d max=%d,%d gold=%d,%d flags=%d exits=%d\n",n,rooms[n].r_pos.x,rooms[n].r_pos.y,rooms[n].r_max.x,rooms[n].r_max.y,rooms[n].r_gold.x,rooms[n].r_gold.y,rooms[n].r_flags,rooms[n].r_nexits);
#endif
        return 0;
    }
    for (n = 0; n < MAXPASS; n++) if (!rs_valid_room_bounds(&passages[n], 1)) {
#ifdef RG_SAVE_DIAGNOSTICS
        fprintf(stderr,"STATE passage %d\n",n);
#endif
        return 0;
    }
    for (monster = mlist; monster != NULL; monster = monster->l_next)
        if (!rs_valid_coord(monster->t_pos) || monster->t_type < 'A' ||
            monster->t_type > 'Z' || monster->t_room == NULL ||
            monster->t_stats.s_str > 31 || !rs_valid_objects(monster->t_pack)) return 0;
    for (n = 0; n < MAXLINES * MAXCOLS; n++) {
        unsigned flags = (unsigned char)places[n].p_flags;
        if ((flags & F_PASS) && (flags & F_PNUM) >= MAXPASS) return 0;
        if (places[n].p_monst != NULL &&
            ((places[n].p_monst->t_pos.x << 5) + places[n].p_monst->t_pos.y) != n)
            return 0;
    }
    if ((cur_armor != NULL && cur_armor->o_type != ARMOR) ||
        /* wield() permits food, sticks and other pack items, except armor. */
        (cur_weapon != NULL && cur_weapon->o_type == ARMOR) ||
        (cur_ring[0] != NULL && cur_ring[0]->o_type != RING) ||
        (cur_ring[1] != NULL && cur_ring[1]->o_type != RING)) return 0;
    return 1;
}

int
rg_state_save_bytes(uint8_t **out, uint32_t *length)
{
    int failed;
    if (out == NULL || length == NULL || rs_web_mode) return -1;
    *out = NULL;
    *length = 0;
    rs_reset();
    rs_web_mode = 1;
    rs_output = NULL;
    rs_output_length = rs_output_capacity = 0;
    failed = rs_save_file(NULL);
    rs_web_mode = 0;
    if (failed) {
        free(rs_output);
        rs_output = NULL;
        return -1;
    }
    *out = rs_output;
    *length = rs_output_length;
    rs_output = NULL;
    rs_output_length = rs_output_capacity = 0;
    return 0;
}

int
rg_state_load_bytes(const uint8_t *bytes, uint32_t length)
{
    uint8_t *backup;
    struct rs_old_owned old;
    int failed;
    if (bytes == NULL || length == 0 || length > RG_SAVE_MAX_BYTES || rs_web_mode)
        return -1;
    backup = rs_capture_globals();
    if (backup == NULL) return -1;
    if (rs_capture_owned(&old) != 0) {
        free(old.strings);
        free(backup);
        return -1;
    }
    rs_reset();
    rs_web_mode = 1;
    rs_input = bytes;
    rs_input_length = length;
    rs_input_offset = 0;
    rs_allocations = NULL;
    rs_allocated_nodes = rs_allocated_bytes = 0;
    failed = rs_restore_file(NULL);
#ifdef RG_SAVE_DIAGNOSTICS
    if (failed) fprintf(stderr,"STATE decode error read=%d format=%d offset=%u/%u\n",read_error,format_error,rs_input_offset,length);
#endif
    if (!failed && (rs_input_offset != length || !rs_valid_restored_state())) failed = 1;
    if (failed) rs_rollback_globals(backup);
    else rs_release_old_owned(&old);
    free(old.strings);
    rs_finish_allocations(failed);
    rs_web_mode = 0;
    rs_input = NULL;
    rs_input_length = rs_input_offset = 0;
    free(backup);
    rs_reset();
    return failed ? -1 : 0;
}
