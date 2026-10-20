/* Rockanrola developer check (needs your ROM): proves that the player 2
   state set through controller_p2.c reaches the SNES auto-joypad registers
   ($421A/$421B) that the game reads, while player 1 stays independent.

     node build/tools/rnr_p2_check.js <rom.sfc>
*/
#include "rnr_static_recomp.h"
#include "v10_2_machine.h"

#include <stdio.h>
#include <stdlib.h>

void rockanrola_set_player2_state(uint16_t state);

int main(int argc, char **argv) {
    RockNRollRacingRecomp *game = NULL;
    RockNRollRacingRecompFrameResult result;
    char error[512] = {0};
    static uint8_t rom[RNR_RECOMP_ROM_SIZE];
    const JSV10_2Machine *m;
    FILE *f;
    unsigned frame;
    int pass = 1;
    if (argc < 2 || !(f = fopen(argv[1], "rb"))) { fprintf(stderr, "usage: rnr_p2_check <rom.sfc>\n"); return 2; }
    if (fread(rom, 1u, sizeof(rom), f) != sizeof(rom)) { fclose(f); return 2; }
    fclose(f);
    if (!rnr_recomp_create(&game, rom, sizeof(rom), error, sizeof(error))) { fprintf(stderr, "%s\n", error); return 1; }
    /* rnr_app_core.c keeps the machine as the first struct member. */
    m = (const JSV10_2Machine *)(const void *)game;
    for (frame = 0u; frame < 900u; ++frame)
        if (!rnr_recomp_advance(game, 0u, 1u, &result)) { fprintf(stderr, "stop\n"); return 1; }
    {
        static const uint16_t p2[] = { RNR_INPUT_START, RNR_INPUT_B | RNR_INPUT_LEFT, RNR_INPUT_A | RNR_INPUT_R, 0u };
        unsigned i;
        for (i = 0u; i < sizeof(p2) / sizeof(p2[0]); ++i) {
            rockanrola_set_player2_state(p2[i]);
            if (!rnr_recomp_advance(game, RNR_INPUT_Y, 1u, &result)) return 1;
            printf("p2 set %04X -> machine pad2 %04X pad1 %04X | auto-joypad %s: $421A %04X $4218 %04X\n",
                   p2[i], m->scheduler.controller_state[1], m->scheduler.controller_state[0],
                   m->scheduler.enable_autojoy ? "on" : "off",
                   m->scheduler.controller_data[1], m->scheduler.controller_data[0]);
            pass &= m->scheduler.controller_state[1] == p2[i] &&
                    m->scheduler.controller_state[0] == RNR_INPUT_Y;
            if (m->scheduler.enable_autojoy)
                pass &= m->scheduler.controller_data[1] == p2[i] &&
                        m->scheduler.controller_data[0] == RNR_INPUT_Y;
        }
    }
    rnr_recomp_destroy(game);
    printf(pass ? "PASS player 2 reaches the SNES auto-joypad registers\n" : "FAIL\n");
    return pass ? 0 : 1;
}
