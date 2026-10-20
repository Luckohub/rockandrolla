/*
 * Rockanrola - WebAssembly glue for the Rock n' Roll Racing (SNES) static
 * recompilation by Junior-Jones (third_party/rnrr-recomp, zlib license).
 *
 * This file only adapts the upstream frontend API (rnr_static_recomp.h) to
 * JavaScript. The game itself runs in the unmodified upstream static core:
 * no emulator, interpreter or substitute game logic is added here.
 *
 * Copyright (c) 2026 Rockanrola contributors. zlib license (see LICENSE).
 */
#include <emscripten/emscripten.h>

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "rnr_static_recomp.h"
#include "rnr_input_latch.h"
#include "bcrypt.h"

#define RNRW_PIXELS (RNR_RECOMP_FRAME_WIDTH * RNR_RECOMP_FRAME_HEIGHT)
#define RNRW_AUDIO_CAPACITY 8192u

static RockNRollRacingRecomp *g_game;
static RockNRollRacingInputLatch g_latch;
static uint8_t g_rgba[RNRW_PIXELS * 4u];
static int16_t g_audio[RNRW_AUDIO_CAPACITY * RNR_RECOMP_AUDIO_CHANNELS];
static char g_error[768];
static uint64_t g_frames_run;

static void set_error(const char *message) {
    (void)snprintf(g_error, sizeof(g_error), "%s", message ? message : "");
}

static uint16_t opposite_of(uint16_t mask) {
    uint16_t out = 0u;
    if (mask & RNR_INPUT_UP) out |= RNR_INPUT_DOWN;
    if (mask & RNR_INPUT_DOWN) out |= RNR_INPUT_UP;
    if (mask & RNR_INPUT_LEFT) out |= RNR_INPUT_RIGHT;
    if (mask & RNR_INPUT_RIGHT) out |= RNR_INPUT_LEFT;
    return out;
}

/* Builds and returns a static string; used by the page for diagnostics. */
EMSCRIPTEN_KEEPALIVE const char *rnrw_version(void) {
    return "Rockanrola web glue 0.1.0 / Rock n' Roll Racing SNES static recomp 1.0.0";
}

EMSCRIPTEN_KEEPALIVE const char *rnrw_last_error(void) {
    return g_error;
}

/* SHA-256 self test (FIPS 180-4 "abc" vector) so the page can prove the
   portable replacement for BCrypt is correct before verifying a ROM. */
EMSCRIPTEN_KEEPALIVE int rnrw_selftest(void) {
    static const uint8_t expected[32] = {
        0xba,0x78,0x16,0xbf,0x8f,0x01,0xcf,0xea,0x41,0x41,0x40,0xde,0x5d,0xae,
        0x22,0x23,0xb0,0x03,0x61,0xa3,0x96,0x17,0x7a,0x9c,0xb4,0x10,0xff,0x61,
        0xf2,0x00,0x15,0xad };
    uint8_t digest[32];
    rockanrola_sha256("abc", 3u, digest);
    return memcmp(digest, expected, sizeof(digest)) == 0;
}

/* Hex SHA-256 of an arbitrary buffer, for user-facing ROM diagnostics. */
EMSCRIPTEN_KEEPALIVE const char *rnrw_sha256_hex(const uint8_t *data, int size) {
    static char hex[65];
    uint8_t digest[32];
    int i;
    if (!data || size < 0) return "";
    rockanrola_sha256(data, (size_t)size, digest);
    for (i = 0; i < 32; ++i) (void)snprintf(hex + i * 2, 3, "%02x", digest[i]);
    return hex;
}

/* Creates the static core from a ROM buffer owned by the caller. The core
   copies the ROM, so the caller may free its buffer right after. */
EMSCRIPTEN_KEEPALIVE int rnrw_create(const uint8_t *rom, int size) {
    char error[512] = {0};
    if (g_game) {
        rnr_recomp_destroy(g_game);
        g_game = NULL;
    }
    rnr_input_latch_reset(&g_latch);
    g_frames_run = 0u;
    if (!rom || size <= 0) {
        set_error("No ROM data was provided.");
        return 0;
    }
    if (!rnr_recomp_create(&g_game, rom, (size_t)size, error, sizeof(error))) {
        g_game = NULL;
        set_error(error);
        return 0;
    }
    set_error("");
    return 1;
}

EMSCRIPTEN_KEEPALIVE int rnrw_loaded(void) {
    return g_game != NULL;
}

EMSCRIPTEN_KEEPALIVE void rnrw_destroy(void) {
    if (g_game) rnr_recomp_destroy(g_game);
    g_game = NULL;
}

EMSCRIPTEN_KEEPALIVE int rnrw_reset(void) {
    char error[512] = {0};
    if (!g_game) { set_error("The game is not loaded."); return 0; }
    rnr_input_latch_reset(&g_latch);
    if (!rnr_recomp_reset(g_game, error, sizeof(error))) {
        set_error(error);
        return 0;
    }
    g_frames_run = 0u;
    return 1;
}

/* Physical button events, using the RNR_INPUT_* SNES masks. */
EMSCRIPTEN_KEEPALIVE void rnrw_press(int mask, int repeated) {
    uint16_t m = (uint16_t)mask;
    rnr_input_latch_press(&g_latch, m, opposite_of(m), repeated);
}

EMSCRIPTEN_KEEPALIVE void rnrw_release(int mask) {
    rnr_input_latch_release(&g_latch, (uint16_t)mask);
}

EMSCRIPTEN_KEEPALIVE void rnrw_release_all(void) {
    rnr_input_latch_reset(&g_latch);
}

static void publish_rgba(void) {
    const uint32_t *bgra = rnr_recomp_frame_bgra(g_game);
    size_t i;
    if (!bgra) return;
    for (i = 0u; i < RNRW_PIXELS; ++i) {
        uint32_t p = bgra[i];
        g_rgba[i * 4u] = (uint8_t)(p >> 16);
        g_rgba[i * 4u + 1u] = (uint8_t)(p >> 8);
        g_rgba[i * 4u + 2u] = (uint8_t)p;
        g_rgba[i * 4u + 3u] = 0xffu;
    }
}

/* Runs `count` complete video frames with the current controller state and
   publishes the last one as RGBA. Extra pad state (e.g. from a gamepad
   polled by JavaScript) is OR-ed into the keyboard latch. Returns 1 on
   success and 0 when the static core stopped fail-closed. */
EMSCRIPTEN_KEEPALIVE int rnrw_run_frames(int count, int extra_mask) {
    RockNRollRacingRecompFrameResult result;
    int i;
    if (!g_game) { set_error("The game is not loaded."); return 0; }
    if (rnr_recomp_failed(g_game)) {
        set_error(rnr_recomp_last_error(g_game));
        return 0;
    }
    for (i = 0; i < count; ++i) {
        uint16_t sampled = rnr_input_latch_sample(&g_latch);
        uint16_t mask = (uint16_t)(sampled | (uint16_t)extra_mask);
        int last = (i == count - 1);
        int ok = last ? rnr_recomp_advance(g_game, mask, 1u, &result)
                      : rnr_recomp_advance_headless(g_game, mask, 1u, &result);
        if (!ok) {
            set_error(rnr_recomp_last_error(g_game));
            return 0;
        }
        rnr_input_latch_consume(&g_latch, sampled);
        g_frames_run++;
    }
    publish_rgba();
    return 1;
}

EMSCRIPTEN_KEEPALIVE uint8_t *rnrw_frame_rgba(void) {
    return g_rgba;
}

EMSCRIPTEN_KEEPALIVE int rnrw_frame_width(void) { return (int)RNR_RECOMP_FRAME_WIDTH; }
EMSCRIPTEN_KEEPALIVE int rnrw_frame_height(void) { return (int)RNR_RECOMP_FRAME_HEIGHT; }
EMSCRIPTEN_KEEPALIVE int rnrw_audio_rate(void) { return (int)RNR_RECOMP_AUDIO_SAMPLE_RATE; }
EMSCRIPTEN_KEEPALIVE double rnrw_fps(void) {
    return (double)RNR_RECOMP_PRESENTATION_FPS_NUMERATOR /
           (double)RNR_RECOMP_PRESENTATION_FPS_DENOMINATOR;
}

EMSCRIPTEN_KEEPALIVE double rnrw_frames_run(void) { return (double)g_frames_run; }
EMSCRIPTEN_KEEPALIVE double rnrw_instructions(void) {
    return g_game ? (double)rnr_recomp_instruction_count(g_game) : 0.0;
}

/* Drains up to RNRW_AUDIO_CAPACITY stereo frames of native 32,040 Hz PCM into
   an internal buffer; returns the number of stereo frames copied. */
EMSCRIPTEN_KEEPALIVE int rnrw_audio_drain(void) {
    if (!g_game) return 0;
    return (int)rnr_recomp_audio_read(g_game, g_audio, RNRW_AUDIO_CAPACITY);
}

EMSCRIPTEN_KEEPALIVE int16_t *rnrw_audio_buffer(void) {
    return g_audio;
}

EMSCRIPTEN_KEEPALIVE void rnrw_audio_discard(void) {
    if (g_game) (void)rnr_recomp_audio_discard(g_game);
}

/* Full-machine snapshots go through the upstream file-based API using the
   in-memory Emscripten filesystem; JavaScript persists the bytes. */
EMSCRIPTEN_KEEPALIVE int rnrw_snapshot_save(const char *path) {
    char error[512] = {0};
    if (!g_game) { set_error("The game is not loaded."); return 0; }
    if (!rnr_recomp_snapshot_save(g_game, path, error, sizeof(error))) {
        set_error(error);
        return 0;
    }
    return 1;
}

EMSCRIPTEN_KEEPALIVE int rnrw_snapshot_load(const char *path) {
    char error[512] = {0};
    if (!g_game) { set_error("The game is not loaded."); return 0; }
    if (!rnr_recomp_snapshot_load(g_game, path, error, sizeof(error))) {
        set_error(error);
        return 0;
    }
    rnr_input_latch_reset(&g_latch);
    return 1;
}
