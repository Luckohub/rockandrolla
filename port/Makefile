# Rockanrola - WebAssembly build of the Rock n' Roll Racing SNES static recomp.
#
# Run inside the pinned Emscripten container (see scripts/build.ps1):
#   make -C port -j4            -> web/engine/rockanrola.{js,wasm}
#   make -C port -j4 tests      -> build/tests/*.js (ROM-free tests for Node)
#   make -C port -j4 bench      -> build/tools/rnr_bench.js (needs your ROM)
#
# Paths are relative to the repository root, which the container mounts at
# /src. Upstream sources are compiled unmodified.

ROOT     := ..
UP       := $(ROOT)/third_party/rnrr-recomp
BUILD    := $(ROOT)/build
OBJ      := $(BUILD)/obj
OUT      := $(ROOT)/web/engine

CC       := emcc
CXX      := em++
OPT      ?= -O3

INCLUDES := -I$(UP)/runtime -I$(UP)/runtime/v10_2_audio \
            -I$(UP)/runtime/v10_2_audio/smp -I$(UP)/runtime/v10_2_audio/dsp \
            -I$(UP)/generated/current/v10_2/smp \
            -I$(UP)/generated/current/v10_2/scpu \
            -I$(UP)/generated/current/v10_2/timing \
            -I$(UP)/frontend/windows -I$(UP)/frontend/common

# Same language modes and core define as the upstream CMakeLists.txt.
CFLAGS   := -std=c11 $(OPT) $(INCLUDES) -DSC_SMP_AOT=1
CXXFLAGS := -std=c++17 $(OPT) $(INCLUDES) -DSC_SMP_AOT=1
# Upstream builds the core with -Wall -Wextra -Wpedantic -Werror on non-MSVC
# compilers; keep that for the hand-written core files.
STRICT   := -Wall -Wextra -Wpedantic -Werror

CORE_STRICT_C := $(UP)/runtime/v05c_static_cpu.c $(UP)/runtime/v10_2_ppu.c \
                 $(UP)/runtime/v10_2_renderer.c $(UP)/runtime/v10_2_machine.c \
                 $(UP)/generated/current/v10_2/timing/js_v10_2_timing.c
CORE_GEN_C    := $(wildcard $(UP)/generated/current/v10_2/scpu/*.c)
CORE_LOOSE_C  := $(UP)/runtime/v10_2_audio/dsp/project_static_dsp.c
CORE_STRICT_CXX := $(UP)/runtime/v10_2_apu.cpp \
                   $(UP)/runtime/v10_2_audio/sc_static_apu.cpp
CORE_LOOSE_CXX  := $(UP)/runtime/v10_2_audio/smp/smp.cpp \
                   $(wildcard $(UP)/generated/current/v10_2/smp/*.cpp)

# Upstream frontend files reused as-is; rnr_app_core.c sees port/shim first
# so its BCrypt SHA-256 calls resolve to the portable implementation.
FRONT_C  := $(UP)/frontend/windows/rnr_app_core.c \
            $(UP)/frontend/common/rnr_input_latch.c
PORT_C   := shim/bcrypt_sha256.c src/rnr_web.c

to_obj = $(patsubst $(ROOT)/%,$(OBJ)/%.o,$(1))

CORE_OBJS := $(call to_obj,$(CORE_STRICT_C) $(CORE_GEN_C) $(CORE_LOOSE_C) \
                           $(CORE_STRICT_CXX) $(CORE_LOOSE_CXX)) \
             $(OBJ)/port/src/fast_snprintf.c.o              $(OBJ)/port/src/apu_sync_batch.c.o
FRONT_OBJS := $(call to_obj,$(FRONT_C))
PORT_OBJS  := $(patsubst %,$(OBJ)/port/%.o,$(PORT_C))

# Generated S-CPU shards are compiled the same way upstream does (default
# warnings) - they are machine output and are never edited by hand.
$(call to_obj,$(CORE_STRICT_C)): $(OBJ)/%.c.o: $(ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(STRICT) -c $< -o $@

$(call to_obj,$(CORE_GEN_C)): $(OBJ)/%.c.o: $(ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(STRICT) -c $< -o $@

$(call to_obj,$(CORE_LOOSE_C)): $(OBJ)/%.c.o: $(ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -w -c $< -o $@

# Clang (unlike the MSVC used by upstream CI) flags two constructs in the
# audio glue: anonymous structs inside the SMP register union (a widely
# supported extension) and the snapshot-restore memcpy into the SMP object.
# Both are intentional upstream code; only these two diagnostics are relaxed.
CXX_RELAX := -Wno-nested-anon-types -Wno-nontrivial-memcall
$(call to_obj,$(CORE_STRICT_CXX)): $(OBJ)/%.cpp.o: $(ROOT)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) $(STRICT) $(CXX_RELAX) -c $< -o $@

$(call to_obj,$(CORE_LOOSE_CXX)): $(OBJ)/%.cpp.o: $(ROOT)/%.cpp
	@mkdir -p $(dir $@)
	$(CXX) $(CXXFLAGS) -w -c $< -o $@

$(FRONT_OBJS): $(OBJ)/%.c.o: $(ROOT)/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -Ishim -Wall -Wextra -Wpedantic -c $< -o $@

$(OBJ)/port/%.c.o: %.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -Ishim $(STRICT) -c $< -o $@

# Batched audio rendezvous (see port/src/apu_sync_batch.c): only the machine
# translation unit is redirected; the upstream file itself is not edited.
APU_BATCH ?= 1
ifeq ($(APU_BATCH),1)
$(OBJ)/third_party/rnrr-recomp/runtime/v10_2_machine.c.o: CFLAGS +=   -Djs_v10_2_apu_sync=rockanrola_apu_sync   -Djs_v10_2_apu_cpu_read=rockanrola_apu_cpu_read   -Djs_v10_2_apu_cpu_write=rockanrola_apu_cpu_write
endif
$(OBJ)/third_party/rnrr-recomp/runtime/v10_2_machine.c.o: Makefile

# ---------------------------------------------------------------- web module
WEB_LDFLAGS := $(OPT) -sMODULARIZE=1 -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createRockanrola -sENVIRONMENT=web \
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB -sSTACK_SIZE=4MB \
  -sFILESYSTEM=1 -sFORCE_FILESYSTEM=1 \
  -sEXPORTED_FUNCTIONS=_malloc,_free \
  -sEXPORTED_RUNTIME_METHODS=FS,UTF8ToString,stringToUTF8,lengthBytesUTF8,HEAPU8,HEAP16 \
  -sINCOMING_MODULE_JS_API=locateFile,wasmBinary,print,printErr,onAbort

.PHONY: all web tests bench clean
all: web
web: $(OUT)/rockanrola.js

$(OUT)/rockanrola.js: $(CORE_OBJS) $(FRONT_OBJS) $(PORT_OBJS) Makefile
	@mkdir -p $(OUT)
	$(CXX) $(filter-out Makefile,$^) $(WEB_LDFLAGS) -o $@

# --------------------------------------------------------- ROM-free tests
NODE_LDFLAGS := $(OPT) -sENVIRONMENT=node -sALLOW_MEMORY_GROWTH=1 \
  -sSTACK_SIZE=8MB -sEXIT_RUNTIME=1 -sNODERAWFS=1
TESTS := test_v10_2_native test_v10_2_machine test_v10_2_ppu test_v10_2_audio
TEST_BINS := $(patsubst %,$(BUILD)/tests/%.js,$(TESTS)) \
             $(BUILD)/tests/test_v10_2_static_dsp.js \
             $(BUILD)/tests/rnr_input_contract_test.js \
             $(BUILD)/tests/test_port_sha256.js \
             $(BUILD)/tests/test_port_rom_rejection.js
tests: $(TEST_BINS)

# Test sources compile to objects first, then link with em++ (the core
# contains C++ audio code).
$(OBJ)/tests/up/%.c.o: $(UP)/tests/native/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(STRICT) -c $< -o $@
$(OBJ)/tests/front/%.c.o: $(UP)/frontend/common/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) $(STRICT) -c $< -o $@
$(OBJ)/tests/port/%.c.o: tests/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -Ishim $(STRICT) -c $< -o $@
$(OBJ)/tools/%.c.o: tools/%.c
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -Ishim $(STRICT) -c $< -o $@

DSP_OBJ   := $(OBJ)/third_party/rnrr-recomp/runtime/v10_2_audio/dsp/project_static_dsp.c.o
LATCH_OBJ := $(OBJ)/third_party/rnrr-recomp/frontend/common/rnr_input_latch.c.o
SHA_OBJ   := $(OBJ)/port/shim/bcrypt_sha256.c.o

$(patsubst %,$(BUILD)/tests/%.js,$(TESTS)): $(BUILD)/tests/%.js: $(OBJ)/tests/up/%.c.o $(CORE_OBJS)
	@mkdir -p $(dir $@)
	$(CXX) $^ $(NODE_LDFLAGS) -o $@

$(BUILD)/tests/test_v10_2_static_dsp.js: $(OBJ)/tests/up/test_v10_2_static_dsp.c.o $(DSP_OBJ)
	@mkdir -p $(dir $@)
	$(CC) $^ $(NODE_LDFLAGS) -o $@

$(BUILD)/tests/rnr_input_contract_test.js: $(OBJ)/tests/front/rnr_input_contract_test.c.o $(LATCH_OBJ)
	@mkdir -p $(dir $@)
	$(CC) $^ $(NODE_LDFLAGS) -o $@

$(BUILD)/tests/test_port_sha256.js: $(OBJ)/tests/port/test_port_sha256.c.o $(SHA_OBJ)
	@mkdir -p $(dir $@)
	$(CC) $^ $(NODE_LDFLAGS) -o $@

$(BUILD)/tests/test_port_rom_rejection.js: $(OBJ)/tests/port/test_port_rom_rejection.c.o $(CORE_OBJS) $(FRONT_OBJS) $(SHA_OBJ)
	@mkdir -p $(dir $@)
	$(CXX) $^ $(NODE_LDFLAGS) -o $@

# ---------------------------------------------- developer benchmark (ROM)
bench: $(BUILD)/tools/rnr_bench.js
$(BUILD)/tools/rnr_bench.js: $(OBJ)/tools/rnr_bench.c.o $(CORE_OBJS) $(FRONT_OBJS) $(SHA_OBJ)
	@mkdir -p $(dir $@)
	$(CXX) $^ $(NODE_LDFLAGS) -o $@

clean:
	rm -rf $(BUILD) $(OUT)/rockanrola.js $(OUT)/rockanrola.wasm
