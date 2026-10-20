/* Rockanrola port test: the unmodified upstream app core, compiled with the
   portable SHA-256 shim, must refuse anything but the exact supported ROM.
   ROM-free: it only feeds synthetic, non-game data. */
#include "rnr_static_recomp.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int expect_reject(const char *name, const uint8_t *rom, size_t size,
                         const char *needle) {
    RockNRollRacingRecomp *game = NULL;
    char error[512] = {0};
    int created = rnr_recomp_create(&game, rom, size, error, sizeof(error));
    if (created || game) {
        printf("FAIL %s: synthetic data was accepted\n", name);
        if (game) rnr_recomp_destroy(game);
        return 0;
    }
    if (!strstr(error, needle)) {
        printf("FAIL %s: unexpected error \"%s\"\n", name, error);
        return 0;
    }
    printf("ok   %s -> \"%s\"\n", name, error);
    return 1;
}

int main(void) {
    uint8_t *data = (uint8_t *)calloc(RNR_RECOMP_ROM_SIZE + 512u, 1u);
    size_t i;
    int pass = 1;
    if (!data) return 2;
    pass &= expect_reject("null rom", NULL, 0u, "1 MiB");
    pass &= expect_reject("short file", data, 4096u, "1 MiB");
    pass &= expect_reject("copier header size", data, RNR_RECOMP_ROM_SIZE + 512u, "1 MiB");
    pass &= expect_reject("zero-filled 1 MiB", data, RNR_RECOMP_ROM_SIZE, "SHA-256 mismatch");
    for (i = 0u; i < RNR_RECOMP_ROM_SIZE; ++i) data[i] = (uint8_t)(i * 2654435761u >> 24);
    pass &= expect_reject("pseudo-random 1 MiB", data, RNR_RECOMP_ROM_SIZE, "SHA-256 mismatch");
    free(data);
    printf(pass ? "PASS test_port_rom_rejection\n" : "FAILED test_port_rom_rejection\n");
    return pass ? 0 : 1;
}
