/*
 * Rockanrola - second SNES controller for the WebAssembly build.
 *
 * Upstream rnr_app_core.c drives controller port 1 (player 2) with a constant
 * 0 every frame, because the Windows launcher is single-player. Rock n' Roll
 * Racing supports two players in split screen, so the web port compiles
 * rnr_app_core.c with
 *   -Djs_v10_2_set_controller_state=rockanrola_set_controller_state
 * and this wrapper substitutes the player 2 state on port 1. Port 0 passes
 * through unchanged, and the upstream file stays unmodified.
 *
 * Copyright (c) 2026 Rockanrola contributors. zlib license.
 */
#include "v10_2_machine.h"

/* Same SNES pad bits as rnr_static_recomp.h. */
#define P2_UP 0x0800u
#define P2_DOWN 0x0400u
#define P2_LEFT 0x0200u
#define P2_RIGHT 0x0100u

static uint16_t g_player2_state;

void rockanrola_set_player2_state(uint16_t state);
void rockanrola_set_controller_state(JSV10_2Machine *m, unsigned port, uint16_t state);

void rockanrola_set_player2_state(uint16_t state) {
    /* A real pad cannot press opposite directions; neutralise them like the
       upstream frontend does for player 1. */
    if ((state & (P2_UP | P2_DOWN)) == (P2_UP | P2_DOWN))
        state = (uint16_t)(state & ~(P2_UP | P2_DOWN));
    if ((state & (P2_LEFT | P2_RIGHT)) == (P2_LEFT | P2_RIGHT))
        state = (uint16_t)(state & ~(P2_LEFT | P2_RIGHT));
    g_player2_state = state;
}

void rockanrola_set_controller_state(JSV10_2Machine *m, unsigned port, uint16_t state) {
    if (port == 1u) state = g_player2_state;
    js_v10_2_set_controller_state(m, port, state);
}
