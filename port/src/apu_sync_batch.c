/*
 * Rockanrola - batched S-SMP/S-DSP rendezvous for the WebAssembly build.
 *
 * Upstream v10_2_machine.c synchronises the audio CPU with the main CPU after
 * every bus access (thousands of times per video frame). Each rendezvous
 * also copies a full status structure and clears an error string, which
 * dominated the WebAssembly profile.
 *
 * The audio clock is path independent: sync_impl() checks on every call that
 * the accumulated SMP cycle count equals the closed-form value for the target
 * master clock, and SMP overshoot is carried. The main CPU can only observe
 * the audio side through the APU I/O ports, and every port access syncs
 * first. Deferring the plain rendezvous by at most one scanline therefore
 * produces the same instruction stream, the same port values and the same
 * PCM sample sequence; only diagnostic counters (sync call count, maximum
 * sync delta, rendezvous hash) change. Verified with port/tools/rnr_bench.c:
 * identical video hash, identical instruction count and identical PCM.
 *
 * Only v10_2_machine.c is compiled with
 *   -Djs_v10_2_apu_sync=rockanrola_apu_sync (and cpu_read / cpu_write)
 * so the upstream source stays unmodified.
 *
 * Copyright (c) 2026 Rockanrola contributors. zlib license.
 */
#include "v10_2_apu.h"

/* One NTSC scanline of master clocks. */
#define ROCKANROLA_APU_SYNC_BATCH 1364u

static uint64_t g_target_master;

JSV10_2ApuResult rockanrola_apu_sync(JSV10_2Apu *apu, uint64_t master_clock);
JSV10_2ApuResult rockanrola_apu_cpu_read(JSV10_2Apu *apu, uint8_t port, uint8_t *value);
JSV10_2ApuResult rockanrola_apu_cpu_write(JSV10_2Apu *apu, uint8_t port, uint8_t value);

JSV10_2ApuResult rockanrola_apu_sync(JSV10_2Apu *apu, uint64_t master_clock) {
    g_target_master = master_clock;
    if (apu && master_clock >= apu->last_master_clock &&
        master_clock - apu->last_master_clock < ROCKANROLA_APU_SYNC_BATCH)
        return JSV10_2_APU_OK;
    return js_v10_2_apu_sync(apu, master_clock);
}

/* Port accesses are always preceded by a sync call with the current master
   clock (v10_2_machine.c), so g_target_master is fresh here. */
static JSV10_2ApuResult flush(JSV10_2Apu *apu) {
    if (apu && g_target_master > apu->last_master_clock)
        return js_v10_2_apu_sync(apu, g_target_master);
    return JSV10_2_APU_OK;
}

JSV10_2ApuResult rockanrola_apu_cpu_read(JSV10_2Apu *apu, uint8_t port, uint8_t *value) {
    JSV10_2ApuResult r = flush(apu);
    if (r != JSV10_2_APU_OK) return r;
    return js_v10_2_apu_cpu_read(apu, port, value);
}

JSV10_2ApuResult rockanrola_apu_cpu_write(JSV10_2Apu *apu, uint8_t port, uint8_t value) {
    JSV10_2ApuResult r = flush(apu);
    if (r != JSV10_2_APU_OK) return r;
    return js_v10_2_apu_cpu_write(apu, port, value);
}
