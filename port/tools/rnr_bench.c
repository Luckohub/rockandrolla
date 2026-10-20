/* Rockanrola developer tool: runs the WebAssembly build of the static core
   headlessly under Node.js against the user's own ROM and reports speed.

     node build/tools/rnr_bench.js <rom.sfc> [frames] [out.ppm]

   It presses Start periodically so the attract/title flow advances, writes
   the final frame as a PPM image and reports how many frames per second the
   WebAssembly core sustains (the game needs ~60.1). The ROM is read locally
   and never copied anywhere. */
#include "rnr_static_recomp.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static double now_seconds(void) {
    struct timespec ts;
    timespec_get(&ts, TIME_UTC);
    return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

static uint8_t *load(const char *path, size_t *size) {
    FILE *f = fopen(path, "rb");
    uint8_t *data = NULL;
    long length;
    if (!f) return NULL;
    if (fseek(f, 0, SEEK_END) == 0 && (length = ftell(f)) > 0 &&
        fseek(f, 0, SEEK_SET) == 0) {
        data = (uint8_t *)malloc((size_t)length);
        if (data && fread(data, 1u, (size_t)length, f) != (size_t)length) {
            free(data);
            data = NULL;
        }
        *size = (size_t)length;
    }
    fclose(f);
    return data;
}

int main(int argc, char **argv) {
    RockNRollRacingRecomp *game = NULL;
    RockNRollRacingRecompFrameResult result;
    char error[512] = {0};
    size_t size = 0u, audio_total = 0u;
    uint8_t *rom, *payload;
    int16_t pcm[4096 * 2];
    unsigned frames = argc > 2 ? (unsigned)strtoul(argv[2], NULL, 10) : 1800u;
    unsigned frame;
    double start, elapsed;

    if (argc < 2) {
        fprintf(stderr, "usage: %s <rom.sfc> [frames] [out.ppm]\n", argv[0]);
        return 2;
    }
    rom = load(argv[1], &size);
    if (!rom) { fprintf(stderr, "cannot read %s\n", argv[1]); return 2; }
    payload = rom;
    if (size == RNR_RECOMP_ROM_SIZE + 512u) { payload += 512; size -= 512u; }
    if (!rnr_recomp_create(&game, payload, size, error, sizeof(error))) {
        fprintf(stderr, "ROM rejected: %s\n", error);
        free(rom);
        return 1;
    }
    free(rom);

    start = now_seconds();
    for (frame = 0u; frame < frames; ++frame) {
        /* Tap Start for 4 frames every 3 seconds to walk through menus. */
        uint16_t input = (frame % 180u) < 4u ? (uint16_t)RNR_INPUT_START : 0u;
        if (!rnr_recomp_advance(game, input, 1u, &result)) {
            fprintf(stderr, "static core stopped at frame %u: %s\n", frame,
                    rnr_recomp_last_error(game));
            rnr_recomp_destroy(game);
            return 1;
        }
        size_t got;
        while ((got = rnr_recomp_audio_read(game, pcm, 4096u)) != 0u)
            audio_total += got;
    }
    elapsed = now_seconds() - start;
    printf("frames=%u seconds=%.3f fps=%.1f (realtime needs 60.1) "
           "instructions=%llu audio_frames=%zu (expected ~%zu)\n",
           frames, elapsed, frames / elapsed,
           (unsigned long long)rnr_recomp_instruction_count(game), audio_total,
           (size_t)(frames * 32040.0 / 60.0988));

    if (argc > 3) {
        const uint32_t *px = rnr_recomp_frame_bgra(game);
        FILE *out = fopen(argv[3], "wb");
        unsigned i;
        if (out && px) {
            fprintf(out, "P6\n256 224\n255\n");
            for (i = 0u; i < 256u * 224u; ++i) {
                uint8_t rgb[3] = {(uint8_t)(px[i] >> 16), (uint8_t)(px[i] >> 8),
                                  (uint8_t)px[i]};
                fwrite(rgb, 1u, 3u, out);
            }
            printf("last frame written to %s\n", argv[3]);
        }
        if (out) fclose(out);
    }
    rnr_recomp_destroy(game);
    return 0;
}
