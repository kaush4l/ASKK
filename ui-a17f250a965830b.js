import { c2w_boot, c2w_exec, c2w_state } from './snippets/adapters_web-c6ebf9abec03fbbe/src/c2w.js';
import { cx_boot, cx_exec, cx_state } from './snippets/adapters_web-c6ebf9abec03fbbe/src/cheerpx.js';
import { RawInterpreter } from './snippets/dioxus-interpreter-js-20451f6aefec841d/inline0.js';
import { setAttributeInner } from './snippets/dioxus-interpreter-js-20451f6aefec841d/src/js/set_attribute.js';
import { get_select_data } from './snippets/dioxus-web-eae67878b22d6805/inline0.js';
import { WebDioxusChannel } from './snippets/dioxus-web-eae67878b22d6805/src/js/eval.js';
import * as import1 from "./snippets/adapters_web-c6ebf9abec03fbbe/src/c2w.js"
import * as import2 from "./snippets/adapters_web-c6ebf9abec03fbbe/src/cheerpx.js"


/**
 * One sub-agent, booted in its Worker and answering goals one at a time.
 * Exported through the same wasm-bindgen glue the page loads, so there is one
 * build, one wasm binary and one set of ports — a sub-agent is not a
 * different program, it is the same program somewhere else.
 */
export class AgentWorker {
    static __wrap(ptr) {
        const obj = Object.create(AgentWorker.prototype);
        obj.__wbg_ptr = ptr;
        AgentWorkerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AgentWorkerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_agentworker_free(ptr, 0);
    }
    /**
     * What this agent has DONE that the page has not been told yet: the tool
     * calls it made, and what it has spent. Cursored, so each fact is reported
     * once — the page appends them to its own log and the Trace, Files and
     * meter surfaces project them like any other fact (I8).
     *
     * Without this a sub-agent was a black box with an answer at the end: its
     * tool calls lived only in its own Worker's log, so the Trace view for any
     * agent but this page's said "recorded there", the Files pane could not
     * see what it wrote, and the meter counted none of its tokens.
     * @returns {string}
     */
    activity() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.agentworker_activity(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Every agent THIS one wrote with `write_agent` (increment 11). Its own
     * log is not the page's, so without this the create-agent superagent would
     * author into a Worker nobody reads. The page adopts them through
     * `core::report_authored`, which records the same fact its own form does.
     * @returns {string}
     */
    authored() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.agentworker_authored(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Build this agent's app. `agents_json` is the `[[folder, text], …]` the
     * page already fetched, `models_json` the catalogue, `profile_json` the
     * user's endpoint choice and keys — a same-origin Worker is inside the
     * same trust boundary as the page that spawned it (ADR-006).
     * @param {string} name
     * @param {string} agents_json
     * @param {string} models_json
     * @param {string} profile_json
     * @returns {Promise<AgentWorker>}
     */
    static boot(name, agents_json, models_json, profile_json) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(agents_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(models_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(profile_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        const ret = wasm.agentworker_boot(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        return ret;
    }
    /**
     * What this agent HOLDS right now: the size of its window and whether its
     * oldest turns are a summary. The page cannot work this out — the window
     * lives in this Wasm instance — so the Worker says, and the page prints
     * what it was told (`ux-walker`, increment 08: a sub-agent had no memory
     * indicator at all).
     * @returns {string}
     */
    memory() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.agentworker_memory(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Take one turn on this agent's own loop and hand back what it said —
     * the Python `ThreadedAgent.invoke`, minus the marshalling, because the
     * message already crossed the boundary. An answerless turn is an error,
     * not an empty string: the caller must be able to tell them apart.
     *
     * And the error carries the CAUSE. This used to discard whatever went
     * wrong and return "<name> produced no answer" — four words naming
     * nothing, where the page's own failure said which endpoint could not be
     * reached and why. The Python's `invoke` re-raises and records `str(e)`;
     * this is the same thing across a `postMessage` boundary.
     * @param {string} goal
     * @returns {Promise<string>}
     */
    run(goal) {
        const ptr0 = passStringToWasm0(goal, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.agentworker_run(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
}
if (Symbol.dispose) AgentWorker.prototype[Symbol.dispose] = AgentWorker.prototype.free;

export class JSOwner {
    static __wrap(ptr) {
        const obj = Object.create(JSOwner.prototype);
        obj.__wbg_ptr = ptr;
        JSOwnerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JSOwnerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsowner_free(ptr, 0);
    }
}
if (Symbol.dispose) JSOwner.prototype[Symbol.dispose] = JSOwner.prototype.free;

/**
 * The booted application, held for the page's lifetime. A wasm-bindgen
 * class (rather than a global) so ownership is explicit and a future
 * multi-agent Worker can hold its own instance (§10 Tier 2). Inner shape is
 * `Rc<RefCell<…>>` because the async runtime half (`core::drive`) runs as
 * spawned tasks that share the app with the sync seam.
 */
export class WebApp {
    static __wrap(ptr) {
        const obj = Object.create(WebApp.prototype);
        obj.__wbg_ptr = ptr;
        WebAppFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebAppFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_webapp_free(ptr, 0);
    }
    /**
     * The composition root: construct the browser ports (IndexedDB store,
     * fetch model/net brokers, real clock, WebCrypto rng), inject them,
     * run `core::boot` (migrations, event replay, built-in registration).
     * The ONLY place adapters meet the core.
     * @returns {Promise<WebApp>}
     */
    static boot() {
        const ret = wasm.webapp_boot();
        return ret;
    }
    /**
     * The seam, transport-shaped: a JSON Request in, the JSON Response out.
     * JSON because the boundary already speaks it — no second wire format to
     * keep honest (I4, I5).
     * @param {string} request_json
     * @returns {string}
     */
    handle_request(request_json) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(request_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.webapp_handle_request(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) WebApp.prototype[Symbol.dispose] = WebApp.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_bce6d499ff0a4aff: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_410e28c7b761ad83: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_2304fb8c853028c8: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_edece8177ad01481: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_07056af4f902c445: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_aeae3893f30ed54e: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_object_b4593df85baada48: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_dde0fd9020db4434: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_c0ed08b3e0f393b9: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_0ad77b7717db155c: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_memory_9544558992fc5400: function() {
            const ret = wasm.memory;
            return ret;
        },
        __wbg___wbindgen_number_get_f73a1244370fcc2c: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_d109740c0d18f4d7: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_3fa391f3fcdb55f8: function(arg0) {
            arg0._wbg_cb_unref();
        },
        __wbg_abort_188f9c740e4a5876: function(arg0) {
            arg0.abort();
        },
        __wbg_addEventListener_aedacff123afaebd: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            arg0.addEventListener(getStringFromWasm0(arg1, arg2), arg3);
        }, arguments); },
        __wbg_agentworker_new: function(arg0) {
            const ret = AgentWorker.__wrap(arg0);
            return ret;
        },
        __wbg_altKey_28623480b46746a3: function(arg0) {
            const ret = arg0.altKey;
            return ret;
        },
        __wbg_altKey_67d0b05000217c49: function(arg0) {
            const ret = arg0.altKey;
            return ret;
        },
        __wbg_altKey_b68079f2b763ba59: function(arg0) {
            const ret = arg0.altKey;
            return ret;
        },
        __wbg_animationName_173d0964ad401eb7: function(arg0, arg1) {
            const ret = arg1.animationName;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_appendChild_6e88800a9a8fb360: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.appendChild(arg1);
            return ret;
        }, arguments); },
        __wbg_arrayBuffer_0ad0e21451bc9ea0: function(arg0) {
            const ret = arg0.arrayBuffer();
            return ret;
        },
        __wbg_back_6b4e37f25101a186: function() { return handleError(function (arg0) {
            arg0.back();
        }, arguments); },
        __wbg_blockSize_ee4adf5b5d40d501: function(arg0) {
            const ret = arg0.blockSize;
            return ret;
        },
        __wbg_blur_2f5c68c34fbb5200: function() { return handleError(function (arg0) {
            arg0.blur();
        }, arguments); },
        __wbg_borderBoxSize_215dfbb37e307adb: function(arg0) {
            const ret = arg0.borderBoxSize;
            return ret;
        },
        __wbg_bound_5870c1ee1e99b719: function() { return handleError(function (arg0, arg1) {
            const ret = IDBKeyRange.bound(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_boundingClientRect_8c36164dd99139d9: function(arg0) {
            const ret = arg0.boundingClientRect;
            return ret;
        },
        __wbg_bubbles_e0fcd71ac2c52cdf: function(arg0) {
            const ret = arg0.bubbles;
            return ret;
        },
        __wbg_button_61ec32cfadc0fbbe: function(arg0) {
            const ret = arg0.button;
            return ret;
        },
        __wbg_buttons_b494fd31ec9cf2fa: function(arg0) {
            const ret = arg0.buttons;
            return ret;
        },
        __wbg_c2w_boot_6726c92275a8fd12: function() { return handleError(function (arg0, arg1) {
            const ret = c2w_boot(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_c2w_exec_2deea5916f69b875: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg2;
                deferred0_1 = arg3;
                const ret = c2w_exec(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
                return ret;
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        }, arguments); },
        __wbg_c2w_state_0b3f3e3ddb3eafb0: function(arg0) {
            const ret = c2w_state();
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_call_13665d9f14390edc: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_dfde26266607c996: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_call_faa0a261f288f846: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.call(arg1, arg2, arg3);
            return ret;
        }, arguments); },
        __wbg_cancel_76ec110de127ef45: function(arg0) {
            arg0.cancel();
        },
        __wbg_changedTouches_149639b20ee398b0: function(arg0) {
            const ret = arg0.changedTouches;
            return ret;
        },
        __wbg_charCodeAt_d67c2a9cf4df1869: function(arg0, arg1) {
            const ret = arg0.charCodeAt(arg1 >>> 0);
            return ret;
        },
        __wbg_checkValidity_e917725a4f3daa2d: function(arg0) {
            const ret = arg0.checkValidity();
            return ret;
        },
        __wbg_checked_eff4e633c5a4b381: function(arg0) {
            const ret = arg0.checked;
            return ret;
        },
        __wbg_clearData_09c075a0ce0f88b0: function() { return handleError(function (arg0) {
            arg0.clearData();
        }, arguments); },
        __wbg_clearData_36dfd63d15a454e5: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.clearData(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_click_7541991684272efc: function(arg0) {
            arg0.click();
        },
        __wbg_clientHeight_02b92bd8f52a1a32: function(arg0) {
            const ret = arg0.clientHeight;
            return ret;
        },
        __wbg_clientWidth_fa33fffa0a76d8ad: function(arg0) {
            const ret = arg0.clientWidth;
            return ret;
        },
        __wbg_clientX_1c7aab4e2acbf3d9: function(arg0) {
            const ret = arg0.clientX;
            return ret;
        },
        __wbg_clientX_4f65e02f53399dc1: function(arg0) {
            const ret = arg0.clientX;
            return ret;
        },
        __wbg_clientY_572d20a07cadd6f0: function(arg0) {
            const ret = arg0.clientY;
            return ret;
        },
        __wbg_clientY_91dc5d824aabd324: function(arg0) {
            const ret = arg0.clientY;
            return ret;
        },
        __wbg_closest_e35efd6dd5eb01f3: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.closest(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_code_5b2bac6d40570b70: function(arg0, arg1) {
            const ret = arg1.code;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_contentBoxSize_b9ecbed6dc31cdfa: function(arg0) {
            const ret = arg0.contentBoxSize;
            return ret;
        },
        __wbg_createComment_7dcce125ba894f86: function(arg0, arg1, arg2) {
            const ret = arg0.createComment(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_createElementNS_10d5e4db26ea11c7: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.createElementNS(arg1 === 0 ? undefined : getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
            return ret;
        }, arguments); },
        __wbg_createElement_d10771800cfb6e7e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.createElement(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_createObjectStore_ce6be0d6715f0760: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.createObjectStore(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_createTextNode_4889277c0228b30c: function(arg0, arg1, arg2) {
            const ret = arg0.createTextNode(getStringFromWasm0(arg1, arg2));
            return ret;
        },
        __wbg_crypto_e3430d75ef2b624b: function() { return handleError(function (arg0) {
            const ret = arg0.crypto;
            return ret;
        }, arguments); },
        __wbg_ctrlKey_1a9651314974e993: function(arg0) {
            const ret = arg0.ctrlKey;
            return ret;
        },
        __wbg_ctrlKey_3e4a4a3a061da469: function(arg0) {
            const ret = arg0.ctrlKey;
            return ret;
        },
        __wbg_ctrlKey_73075f1a7f7c56c6: function(arg0) {
            const ret = arg0.ctrlKey;
            return ret;
        },
        __wbg_cx_boot_16623a8b82273846: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            const ret = cx_boot(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5));
            return ret;
        }, arguments); },
        __wbg_cx_exec_7879deef6043c019: function() { return handleError(function (arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                const ret = cx_exec(getStringFromWasm0(arg0, arg1));
                return ret;
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        }, arguments); },
        __wbg_cx_state_6f2e2c3b2f3407ef: function(arg0) {
            const ret = cx_state();
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_dataTransfer_37da999563a277c7: function(arg0) {
            const ret = arg0.dataTransfer;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_data_5fc79a19e47d1531: function(arg0) {
            const ret = arg0.data;
            return ret;
        },
        __wbg_data_89035f83fc9efc68: function(arg0, arg1) {
            const ret = arg1.data;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_delete_bc03f88e7f14db56: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.delete(arg1);
            return ret;
        }, arguments); },
        __wbg_deltaMode_f2f7384642c27d42: function(arg0) {
            const ret = arg0.deltaMode;
            return ret;
        },
        __wbg_deltaX_39ba1b485e5ce734: function(arg0) {
            const ret = arg0.deltaX;
            return ret;
        },
        __wbg_deltaY_9bad500402885525: function(arg0) {
            const ret = arg0.deltaY;
            return ret;
        },
        __wbg_deltaZ_418eac5931d04a94: function(arg0) {
            const ret = arg0.deltaZ;
            return ret;
        },
        __wbg_detail_fbf8f74d784d9dd1: function(arg0) {
            const ret = arg0.detail;
            return ret;
        },
        __wbg_documentElement_b2c902eee886c54d: function(arg0) {
            const ret = arg0.documentElement;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_document_3540635616a18455: function(arg0) {
            const ret = arg0.document;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_done_54b8da57023b7ed2: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_dropEffect_10cbef4505524a14: function(arg0, arg1) {
            const ret = arg1.dropEffect;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_effectAllowed_7242eeabe0df6111: function(arg0, arg1) {
            const ret = arg1.effectAllowed;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_elapsedTime_2ca1b7e1a0857c30: function(arg0) {
            const ret = arg0.elapsedTime;
            return ret;
        },
        __wbg_elapsedTime_6d21377e6966ce36: function(arg0) {
            const ret = arg0.elapsedTime;
            return ret;
        },
        __wbg_entries_564a7e8b1e54ede5: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_entries_bf41ee80855f12bf: function(arg0) {
            const ret = arg0.entries();
            return ret;
        },
        __wbg_error_ef9cbaece146d1d5: function() { return handleError(function (arg0) {
            const ret = arg0.error;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_error_f085d7e62279b703: function(arg0) {
            console.error(arg0);
        },
        __wbg_fetch_5a1b3cb2bf93cd1c: function(arg0, arg1, arg2, arg3) {
            const ret = arg0.fetch(getStringFromWasm0(arg1, arg2), arg3);
            return ret;
        },
        __wbg_files_65a179c52b205fab: function(arg0) {
            const ret = arg0.files;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_files_a4ab9c6816f56dbe: function(arg0) {
            const ret = arg0.files;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_focus_f37157dd6c795de6: function() { return handleError(function (arg0) {
            arg0.focus();
        }, arguments); },
        __wbg_force_48d63a1a03e0f782: function(arg0) {
            const ret = arg0.force;
            return ret;
        },
        __wbg_forward_0e40822f17c65581: function() { return handleError(function (arg0) {
            arg0.forward();
        }, arguments); },
        __wbg_getAllKeys_f89adaa18225a139: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.getAllKeys(arg1);
            return ret;
        }, arguments); },
        __wbg_getAsFile_f9628629beac6412: function() { return handleError(function (arg0) {
            const ret = arg0.getAsFile();
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_getAttribute_bea260b21f4e71cc: function(arg0, arg1, arg2, arg3) {
            const ret = arg1.getAttribute(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_getBoundingClientRect_9169b7906daaa798: function(arg0) {
            const ret = arg0.getBoundingClientRect();
            return ret;
        },
        __wbg_getData_f2699962a86ac612: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.getData(getStringFromWasm0(arg2, arg3));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getElementById_78449141d07cd8ef: function(arg0, arg1, arg2) {
            const ret = arg0.getElementById(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_getItem_88cc26174f98c20c: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg1.getItem(getStringFromWasm0(arg2, arg3));
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_getNode_b14ec18ffa4892a9: function(arg0, arg1) {
            const ret = arg0.getNode(arg1 >>> 0);
            return ret;
        },
        __wbg_getRandomValues_af1380ee144a142b: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.getRandomValues(getArrayU8FromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_getVoices_923d824e37a2fcaa: function(arg0) {
            const ret = arg0.getVoices();
            return ret;
        },
        __wbg_get_08c21a467c4cc260: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_get_1e1b17fabb6adcd9: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_get_282479343925bf04: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_get_3e9a707ab7d352eb: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_98fdf51d029a75eb: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_a29eb08d8e2fbd2b: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_get_b6f278d067d9edad: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.get(arg1);
            return ret;
        }, arguments); },
        __wbg_get_dcf82ab8aad1a593: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_select_data_44a585f337de4182: function(arg0, arg1) {
            const ret = get_select_data(arg1);
            const ptr1 = passArrayJsValueToWasm0(ret, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_get_unchecked_1dfe6d05ad91d9b7: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_hash_db43ea0a219f3045: function() { return handleError(function (arg0, arg1) {
            const ret = arg1.hash;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_head_a88d9bdd6dd82565: function(arg0) {
            const ret = arg0.head;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_headers_4cfb0c75793d7a8d: function(arg0) {
            const ret = arg0.headers;
            return ret;
        },
        __wbg_height_110f80d27112b6b3: function(arg0) {
            const ret = arg0.height;
            return ret;
        },
        __wbg_height_d8863979f34edae6: function(arg0) {
            const ret = arg0.height;
            return ret;
        },
        __wbg_height_f74a1eb7b5b0c092: function(arg0) {
            const ret = arg0.height;
            return ret;
        },
        __wbg_history_4fea091a79b506f0: function() { return handleError(function (arg0) {
            const ret = arg0.history;
            return ret;
        }, arguments); },
        __wbg_identifier_de2b46be864f9f19: function(arg0) {
            const ret = arg0.identifier;
            return ret;
        },
        __wbg_indexedDB_2e82cb845ce6b3ad: function() { return handleError(function (arg0) {
            const ret = arg0.indexedDB;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_indexedDB_cbfeacc981615a77: function() { return handleError(function (arg0) {
            const ret = arg0.indexedDB;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_initialize_6d1129af221f598b: function(arg0, arg1, arg2) {
            arg0.initialize(arg1, arg2);
        },
        __wbg_inlineSize_2e304e552f674d7f: function(arg0) {
            const ret = arg0.inlineSize;
            return ret;
        },
        __wbg_innerWidth_d3640f54d24f0965: function() { return handleError(function (arg0) {
            const ret = arg0.innerWidth;
            return ret;
        }, arguments); },
        __wbg_instanceof_AnimationEvent_7462d48f129b4056: function(arg0) {
            let result;
            try {
                result = arg0 instanceof AnimationEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_53db37b06f6b9afe: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Blob_ef93d187bbde5360: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Blob;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_CompositionEvent_26cbe61a6d01bfeb: function(arg0) {
            let result;
            try {
                result = arg0 instanceof CompositionEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_CustomEvent_0f5f7793012aa714: function(arg0) {
            let result;
            try {
                result = arg0 instanceof CustomEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Document_e6309c540429c050: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Document;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_DomException_bc16ce893e8c7439: function(arg0) {
            let result;
            try {
                result = arg0 instanceof DOMException;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_DragEvent_0d9d92d54f176490: function(arg0) {
            let result;
            try {
                result = arg0 instanceof DragEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Element_244fd1e5d45219a6: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Element;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Error_b3f7e146d654031a: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Error;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Event_7bf68d0220f25bce: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Event;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_File_ff44f58d73b35ec5: function(arg0) {
            let result;
            try {
                result = arg0 instanceof File;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_FocusEvent_f68bceb657ebc3b7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof FocusEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_HtmlElement_02c2813e0b28553a: function(arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_HtmlFormElement_eca2686b1085df7c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLFormElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_HtmlInputElement_4aa17180fd35ef36: function(arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLInputElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_HtmlSelectElement_6a8c915e83a23835: function(arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLSelectElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_HtmlTextAreaElement_32557f7b0847ecd8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof HTMLTextAreaElement;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_KeyboardEvent_50cb8f33aac74605: function(arg0) {
            let result;
            try {
                result = arg0 instanceof KeyboardEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_16f217b9a2a08d8c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_MouseEvent_9542b364a3982a8c: function(arg0) {
            let result;
            try {
                result = arg0 instanceof MouseEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Node_788cd338c1205370: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Node;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Object_03924e0dbda74bd8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Object;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_PointerEvent_5d5f7b56f1bb921b: function(arg0) {
            let result;
            try {
                result = arg0 instanceof PointerEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Promise_09012cfa9708520a: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Response_ecfc823e8fb354e2: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_TouchEvent_f4200f1cf1e4e505: function(arg0) {
            let result;
            try {
                result = arg0 instanceof TouchEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_TransitionEvent_5c3dba68e0f87adc: function(arg0) {
            let result;
            try {
                result = arg0 instanceof TransitionEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_abd07d4bd221d50b: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_WheelEvent_7b59b174a0f0e50e: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WheelEvent;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Window_faa5cf994f49cca7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_WorkerGlobalScope_a93ee1765e6a23bf: function(arg0) {
            let result;
            try {
                result = arg0 instanceof WorkerGlobalScope;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_intersectionRatio_30eb7e7f1875496c: function(arg0) {
            const ret = arg0.intersectionRatio;
            return ret;
        },
        __wbg_intersectionRect_5d313a63dd8214d6: function(arg0) {
            const ret = arg0.intersectionRect;
            return ret;
        },
        __wbg_isArray_94898ed3aad6947b: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isComposing_fba57ab334a1798f: function(arg0) {
            const ret = arg0.isComposing;
            return ret;
        },
        __wbg_isFinal_4b3db7d5c15b5cd2: function(arg0) {
            const ret = arg0.isFinal;
            return ret;
        },
        __wbg_isIntersecting_5c5faa1879b11bb0: function(arg0) {
            const ret = arg0.isIntersecting;
            return ret;
        },
        __wbg_isPrimary_57b2b99e5f066448: function(arg0) {
            const ret = arg0.isPrimary;
            return ret;
        },
        __wbg_isSafeInteger_01e964d144ad3a55: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_item_06b48a6a5b68fe31: function(arg0, arg1) {
            const ret = arg0.item(arg1 >>> 0);
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_item_392e7a44a777cea6: function(arg0, arg1) {
            const ret = arg0.item(arg1 >>> 0);
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_items_0600f694e5f997a5: function(arg0) {
            const ret = arg0.items;
            return ret;
        },
        __wbg_iterator_1441b47f341dc34f: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_key_daba1c10e3b408ef: function(arg0, arg1) {
            const ret = arg1.key;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_kind_fffa1c95b8d663dc: function(arg0, arg1) {
            const ret = arg1.kind;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_lastModified_e185558716f485ac: function(arg0) {
            const ret = arg0.lastModified;
            return ret;
        },
        __wbg_left_235f0dc266f4c6f7: function(arg0) {
            const ret = arg0.left;
            return ret;
        },
        __wbg_length_0ff9501fb22b32dd: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_2591a0f4f659a55c: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_50bb65443195b9cd: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_56fcd3e2b7e0299d: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_57d0cee4d4dcedcd: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_c1098058efb0dae8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_d07967af9a7e619e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_f83cc3ef069d6a23: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_localStorage_e3f4a792bb36c514: function() { return handleError(function (arg0) {
            const ret = arg0.localStorage;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_location_64bcc53b4356fa39: function(arg0) {
            const ret = arg0.location;
            return ret;
        },
        __wbg_location_e8e32db14f684695: function(arg0) {
            const ret = arg0.location;
            return ret;
        },
        __wbg_log_0c201ade58bb55e1: function(arg0, arg1, arg2, arg3, arg4, arg5, arg6, arg7) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.log(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3), getStringFromWasm0(arg4, arg5), getStringFromWasm0(arg6, arg7));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_log_ce2c4456b290c5e7: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.log(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_mark_b4d943f3bc2d2404: function(arg0, arg1) {
            performance.mark(getStringFromWasm0(arg0, arg1));
        },
        __wbg_measure_84362959e621a2c1: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            let deferred0_0;
            let deferred0_1;
            let deferred1_0;
            let deferred1_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                deferred1_0 = arg2;
                deferred1_1 = arg3;
                performance.measure(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }, arguments); },
        __wbg_message_324ac511aeaf710e: function(arg0) {
            const ret = arg0.message;
            return ret;
        },
        __wbg_metaKey_7383635a2f7f9e5f: function(arg0) {
            const ret = arg0.metaKey;
            return ret;
        },
        __wbg_metaKey_981e09e2615c47b7: function(arg0) {
            const ret = arg0.metaKey;
            return ret;
        },
        __wbg_metaKey_aa5f1f855431d0fa: function(arg0) {
            const ret = arg0.metaKey;
            return ret;
        },
        __wbg_name_833abcd2bdd841da: function(arg0, arg1) {
            const ret = arg1.name;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_name_ee4d5c37abab5283: function(arg0, arg1) {
            const ret = arg1.name;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_name_fe88cfc178ec40b8: function(arg0, arg1) {
            const ret = arg1.name;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_new_02d162bc6cf02f60: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_070df68d66325372: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_2e8d69c4aea512ac: function() { return handleError(function () {
            const ret = new FileReader();
            return ret;
        }, arguments); },
        __wbg_new_310879b66b6e95e1: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_670bc4130018622d: function() { return handleError(function () {
            const ret = new SpeechRecognition();
            return ret;
        }, arguments); },
        __wbg_new_7ddec6de44ff8f5d: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_8f5fda55dcab0a95: function() { return handleError(function () {
            const ret = new DataTransfer();
            return ret;
        }, arguments); },
        __wbg_new_c5dc7c0518fdb0ba: function(arg0) {
            const ret = new RawInterpreter(arg0 >>> 0);
            return ret;
        },
        __wbg_new_d8dfd33fa007511d: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h2d137bb2853bc8bb(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_e942d9e3968e46f8: function(arg0) {
            const ret = new WebDioxusChannel(JSOwner.__wrap(arg0));
            return ret;
        },
        __wbg_new_from_slice_269e35316ed2d061: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_new_typed_c072c4ce9a2a0cdf: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return wasm_bindgen__convert__closures_____invoke__h2d137bb2853bc8bb(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return ret;
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_args_eb708fe9c2ba7cfd: function(arg0, arg1, arg2, arg3) {
            const ret = new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
            return ret;
        },
        __wbg_new_with_form_767c791976dd8219: function() { return handleError(function (arg0) {
            const ret = new FormData(arg0);
            return ret;
        }, arguments); },
        __wbg_new_with_options_a7c9673c90fce21f: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Worker(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_with_str_and_init_ffe9977c986ea039: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), arg2);
            return ret;
        }, arguments); },
        __wbg_new_with_text_9553f43fc91b0f2a: function() { return handleError(function (arg0, arg1) {
            const ret = new SpeechSynthesisUtterance(getStringFromWasm0(arg0, arg1));
            return ret;
        }, arguments); },
        __wbg_next_2a4e19f4f5083b0f: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_6429a146bf756f93: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_now_81363d44c96dd239: function() {
            const ret = Date.now();
            return ret;
        },
        __wbg_objectStore_b28adb984a77902e: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.objectStore(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_offsetX_33e541f377c3ef38: function(arg0) {
            const ret = arg0.offsetX;
            return ret;
        },
        __wbg_offsetY_79c8223b1054870e: function(arg0) {
            const ret = arg0.offsetY;
            return ret;
        },
        __wbg_ok_556a55299dd238ba: function(arg0) {
            const ret = arg0.ok;
            return ret;
        },
        __wbg_open_40ab11cdd8f5ac5a: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.open(getStringFromWasm0(arg1, arg2), arg3 >>> 0);
            return ret;
        }, arguments); },
        __wbg_ownerDocument_496a249017f8ddda: function(arg0) {
            const ret = arg0.ownerDocument;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_pageX_675f7219608c3f35: function(arg0) {
            const ret = arg0.pageX;
            return ret;
        },
        __wbg_pageX_9660a11059cb86d5: function(arg0) {
            const ret = arg0.pageX;
            return ret;
        },
        __wbg_pageY_08e99d5f10ef75ab: function(arg0) {
            const ret = arg0.pageY;
            return ret;
        },
        __wbg_pageY_91ad4a0013c608f3: function(arg0) {
            const ret = arg0.pageY;
            return ret;
        },
        __wbg_parentElement_6da9938b7d952c3c: function(arg0) {
            const ret = arg0.parentElement;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_pathname_4da19d3e179041e2: function() { return handleError(function (arg0, arg1) {
            const ret = arg1.pathname;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_pointerId_b61ce7aca1eab0cc: function(arg0) {
            const ret = arg0.pointerId;
            return ret;
        },
        __wbg_pointerType_3bff100b661de828: function(arg0, arg1) {
            const ret = arg1.pointerType;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_postMessage_b9f21cd0af88b26a: function() { return handleError(function (arg0, arg1) {
            arg0.postMessage(arg1);
        }, arguments); },
        __wbg_pressure_978243a58b7d21ff: function(arg0) {
            const ret = arg0.pressure;
            return ret;
        },
        __wbg_preventDefault_077a15ca7e97dc5a: function(arg0) {
            arg0.preventDefault();
        },
        __wbg_propertyName_a710ef7f22ebe7fe: function(arg0, arg1) {
            const ret = arg1.propertyName;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_pseudoElement_8b39149154308917: function(arg0, arg1) {
            const ret = arg1.pseudoElement;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_pseudoElement_a55ef7d358a01d1d: function(arg0, arg1) {
            const ret = arg1.pseudoElement;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_pushState_c8f418e428c76877: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.pushState(arg1, getStringFromWasm0(arg2, arg3), arg4 === 0 ? undefined : getStringFromWasm0(arg4, arg5));
        }, arguments); },
        __wbg_push_b77c476b01548d0a: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_put_ad17713e2c2f12fa: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.put(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_querySelectorAll_0981bdbbafa5bf17: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.querySelectorAll(getStringFromWasm0(arg1, arg2));
            return ret;
        }, arguments); },
        __wbg_querySelector_54149fe79b2a2091: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.querySelector(getStringFromWasm0(arg1, arg2));
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        }, arguments); },
        __wbg_queueMicrotask_78d584b53af520f5: function(arg0) {
            const ret = arg0.queueMicrotask;
            return ret;
        },
        __wbg_queueMicrotask_b39ea83c7f01971a: function(arg0) {
            queueMicrotask(arg0);
        },
        __wbg_radiusX_9b6f4516397f9f9b: function(arg0) {
            const ret = arg0.radiusX;
            return ret;
        },
        __wbg_radiusY_29183f838bc89c41: function(arg0) {
            const ret = arg0.radiusY;
            return ret;
        },
        __wbg_readAsArrayBuffer_79bb9c60d6929e70: function() { return handleError(function (arg0, arg1) {
            arg0.readAsArrayBuffer(arg1);
        }, arguments); },
        __wbg_readAsText_12f3125009812134: function() { return handleError(function (arg0, arg1) {
            arg0.readAsText(arg1);
        }, arguments); },
        __wbg_reload_55bba497dd160810: function() { return handleError(function (arg0) {
            arg0.reload();
        }, arguments); },
        __wbg_removeAttribute_69b4f669d167f410: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.removeAttribute(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_removeItem_9b48e0e4faf386fc: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.removeItem(getStringFromWasm0(arg1, arg2));
        }, arguments); },
        __wbg_repeat_128826dd0fbe2999: function(arg0) {
            const ret = arg0.repeat;
            return ret;
        },
        __wbg_replaceState_213b1c5318c79ce1: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4, arg5) {
            arg0.replaceState(arg1, getStringFromWasm0(arg2, arg3), arg4 === 0 ? undefined : getStringFromWasm0(arg4, arg5));
        }, arguments); },
        __wbg_requestAnimationFrame_0ed67cfff9dd8396: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.requestAnimationFrame(arg1);
            return ret;
        }, arguments); },
        __wbg_resolve_d17db9352f5a220e: function(arg0) {
            const ret = Promise.resolve(arg0);
            return ret;
        },
        __wbg_resultIndex_74b0466b35303cac: function(arg0) {
            const ret = arg0.resultIndex;
            return ret;
        },
        __wbg_result_7456db69d047c421: function() { return handleError(function (arg0) {
            const ret = arg0.result;
            return ret;
        }, arguments); },
        __wbg_result_c4cb33cd39c97cac: function() { return handleError(function (arg0) {
            const ret = arg0.result;
            return ret;
        }, arguments); },
        __wbg_results_16c7e6f4d40028c8: function(arg0) {
            const ret = arg0.results;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_rootBounds_c01dc1ee19a71a87: function(arg0) {
            const ret = arg0.rootBounds;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_rotationAngle_bc72e1626926db9b: function(arg0) {
            const ret = arg0.rotationAngle;
            return ret;
        },
        __wbg_run_005df3744a5aa7cf: function(arg0) {
            arg0.run();
        },
        __wbg_rustRecv_c9dcac227ecc00d9: function(arg0) {
            const ret = arg0.rustRecv();
            return ret;
        },
        __wbg_rustSend_56478f16de514546: function(arg0, arg1) {
            arg0.rustSend(arg1);
        },
        __wbg_saveTemplate_e3c1a1e2ac405343: function(arg0, arg1, arg2, arg3) {
            var v0 = getArrayJsValueFromWasm0(arg1, arg2).slice();
            wasm.__wbindgen_free(arg1, arg2 * 4, 4);
            arg0.saveTemplate(v0, arg3);
        },
        __wbg_screenX_89c3b2d463613cb0: function(arg0) {
            const ret = arg0.screenX;
            return ret;
        },
        __wbg_screenX_edbe9b154d1d99e2: function(arg0) {
            const ret = arg0.screenX;
            return ret;
        },
        __wbg_screenY_1ced95cb43e69527: function(arg0) {
            const ret = arg0.screenY;
            return ret;
        },
        __wbg_screenY_716549fb62f64f25: function(arg0) {
            const ret = arg0.screenY;
            return ret;
        },
        __wbg_scrollHeight_1987f4aa820bbd8d: function(arg0) {
            const ret = arg0.scrollHeight;
            return ret;
        },
        __wbg_scrollIntoView_b18137e7824132d4: function(arg0, arg1) {
            arg0.scrollIntoView(arg1);
        },
        __wbg_scrollIntoView_f76fba9ac26f6359: function(arg0, arg1) {
            arg0.scrollIntoView(arg1 !== 0);
        },
        __wbg_scrollLeft_04751bc428972599: function(arg0) {
            const ret = arg0.scrollLeft;
            return ret;
        },
        __wbg_scrollTo_ccaa9e79248170ed: function(arg0, arg1, arg2) {
            arg0.scrollTo(arg1, arg2);
        },
        __wbg_scrollTop_3a9db06196adf0be: function(arg0) {
            const ret = arg0.scrollTop;
            return ret;
        },
        __wbg_scrollWidth_6a99d992562f982d: function(arg0) {
            const ret = arg0.scrollWidth;
            return ret;
        },
        __wbg_scrollX_803467e7bd351fac: function() { return handleError(function (arg0) {
            const ret = arg0.scrollX;
            return ret;
        }, arguments); },
        __wbg_scrollY_da06c242ee1df3b9: function() { return handleError(function (arg0) {
            const ret = arg0.scrollY;
            return ret;
        }, arguments); },
        __wbg_scroll_6256ab25c01773ee: function(arg0, arg1) {
            arg0.scroll(arg1);
        },
        __wbg_search_041a4f2d10cdd2ec: function() { return handleError(function (arg0, arg1) {
            const ret = arg1.search;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_setAttributeInner_a29bef1cf5d53ffe: function(arg0, arg1, arg2, arg3, arg4, arg5) {
            setAttributeInner(arg0, getStringFromWasm0(arg1, arg2), arg3, arg4 === 0 ? undefined : getStringFromWasm0(arg4, arg5));
        },
        __wbg_setAttribute_2e611c7b4151e535: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setAttribute(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setData_8931c4375dc75e4d: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setData(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setItem_caab843cd6845dbb: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.setItem(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_setTimeout_4a8f96a1b4261aee: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = arg0.setTimeout(arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_78ea6a19f4818587: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_set_a0e911be3da02782: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbg_set_behavior_797cdba993c4315f: function(arg0, arg1) {
            arg0.behavior = __wbindgen_enum_ScrollBehavior[arg1];
        },
        __wbg_set_behavior_e9975af6d022653d: function(arg0, arg1) {
            arg0.behavior = __wbindgen_enum_ScrollBehavior[arg1];
        },
        __wbg_set_block_2dbae36004bd83fd: function(arg0, arg1) {
            arg0.block = __wbindgen_enum_ScrollLogicalPosition[arg1];
        },
        __wbg_set_body_7f56457720e81672: function(arg0, arg1) {
            arg0.body = arg1;
        },
        __wbg_set_cache_9ed01a3813d96de2: function(arg0, arg1) {
            arg0.cache = __wbindgen_enum_RequestCache[arg1];
        },
        __wbg_set_continuous_50352d050a7381cd: function() { return handleError(function (arg0, arg1) {
            arg0.continuous = arg1 !== 0;
        }, arguments); },
        __wbg_set_d57e5106f0271787: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            arg0.set(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_set_dropEffect_548640f4dec94e40: function(arg0, arg1, arg2) {
            arg0.dropEffect = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_effectAllowed_efde71d6fdbfb0a1: function(arg0, arg1, arg2) {
            arg0.effectAllowed = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_facb7a5914e0fa39: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_hash_62c4dbdd31cfb200: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.hash = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_href_e5f77c13bdad8ef8: function() { return handleError(function (arg0, arg1, arg2) {
            arg0.href = getStringFromWasm0(arg1, arg2);
        }, arguments); },
        __wbg_set_inline_45194936fb175f10: function(arg0, arg1) {
            arg0.inline = __wbindgen_enum_ScrollLogicalPosition[arg1];
        },
        __wbg_set_interimResults_83b1ac1e8d80a67e: function(arg0, arg1) {
            arg0.interimResults = arg1 !== 0;
        },
        __wbg_set_left_3f52710147723af9: function(arg0, arg1) {
            arg0.left = arg1;
        },
        __wbg_set_method_4d69a1a7e34c0aca: function(arg0, arg1, arg2) {
            arg0.method = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_name_986a0b8d9573b90f: function(arg0, arg1, arg2) {
            arg0.name = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_onend_eea5e1003cf2107a: function(arg0, arg1) {
            arg0.onend = arg1;
        },
        __wbg_set_onerror_38740b892815eedc: function(arg0, arg1) {
            arg0.onerror = arg1;
        },
        __wbg_set_onload_8e6d5709e9c8deaa: function(arg0, arg1) {
            arg0.onload = arg1;
        },
        __wbg_set_onmessage_9d5b71be2b1644a2: function(arg0, arg1) {
            arg0.onmessage = arg1;
        },
        __wbg_set_onresult_4ab3674f16c491c9: function(arg0, arg1) {
            arg0.onresult = arg1;
        },
        __wbg_set_onsuccess_b556141053d02ea7: function(arg0, arg1) {
            arg0.onsuccess = arg1;
        },
        __wbg_set_onupgradeneeded_f885fa17614acd2b: function(arg0, arg1) {
            arg0.onupgradeneeded = arg1;
        },
        __wbg_set_onvoiceschanged_074fb3bb77cf0f6f: function(arg0, arg1) {
            arg0.onvoiceschanged = arg1;
        },
        __wbg_set_scrollRestoration_2db7593ff0106e48: function() { return handleError(function (arg0, arg1) {
            arg0.scrollRestoration = __wbindgen_enum_ScrollRestoration[arg1];
        }, arguments); },
        __wbg_set_scrollTop_e4ea1f04309311f2: function(arg0, arg1) {
            arg0.scrollTop = arg1;
        },
        __wbg_set_signal_2a5bd3615938edbc: function(arg0, arg1) {
            arg0.signal = arg1;
        },
        __wbg_set_textContent_9c5d65d703443b6d: function(arg0, arg1, arg2) {
            arg0.textContent = arg1 === 0 ? undefined : getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_top_35b2c5ab7a8d880d: function(arg0, arg1) {
            arg0.top = arg1;
        },
        __wbg_set_type_631a620aeed3d665: function(arg0, arg1) {
            arg0.type = __wbindgen_enum_WorkerType[arg1];
        },
        __wbg_shiftKey_8a7db9003147d850: function(arg0) {
            const ret = arg0.shiftKey;
            return ret;
        },
        __wbg_shiftKey_ad7099cca77a6863: function(arg0) {
            const ret = arg0.shiftKey;
            return ret;
        },
        __wbg_shiftKey_eb507c5f283951e4: function(arg0) {
            const ret = arg0.shiftKey;
            return ret;
        },
        __wbg_size_479dc0966d87acd5: function(arg0) {
            const ret = arg0.size;
            return ret;
        },
        __wbg_speak_925c80c9e7aa71be: function(arg0, arg1) {
            arg0.speak(arg1);
        },
        __wbg_speechSynthesis_7cc743829024c420: function() { return handleError(function (arg0) {
            const ret = arg0.speechSynthesis;
            return ret;
        }, arguments); },
        __wbg_start_2a4cd7093f6bfbfa: function() { return handleError(function (arg0) {
            arg0.start();
        }, arguments); },
        __wbg_state_41cc2a081052101b: function() { return handleError(function (arg0) {
            const ret = arg0.state;
            return ret;
        }, arguments); },
        __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_9b2406c23aeb2023: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b34d2126934e16ba: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_status_0853c9f5752c7ee2: function(arg0) {
            const ret = arg0.status;
            return ret;
        },
        __wbg_stop_8e77088c5bae4911: function(arg0) {
            arg0.stop();
        },
        __wbg_stringify_ef0c105b1ccc3849: function() { return handleError(function (arg0) {
            const ret = JSON.stringify(arg0);
            return ret;
        }, arguments); },
        __wbg_tangentialPressure_0c88bf59e13c5e24: function(arg0) {
            const ret = arg0.tangentialPressure;
            return ret;
        },
        __wbg_targetTouches_9bd493f6855fc6a7: function(arg0) {
            const ret = arg0.targetTouches;
            return ret;
        },
        __wbg_target_84e05e84ffc12989: function(arg0) {
            const ret = arg0.target;
            return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_terminate_30aaf670707b583d: function(arg0) {
            arg0.terminate();
        },
        __wbg_textContent_ac14c773b5616f3f: function(arg0, arg1) {
            const ret = arg1.textContent;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_text_99930d92d5f1b540: function() { return handleError(function (arg0) {
            const ret = arg0.text();
            return ret;
        }, arguments); },
        __wbg_then_837494e384b37459: function(arg0, arg1) {
            const ret = arg0.then(arg1);
            return ret;
        },
        __wbg_then_bd927500e8905df2: function(arg0, arg1, arg2) {
            const ret = arg0.then(arg1, arg2);
            return ret;
        },
        __wbg_tiltX_cce51243dc48e43e: function(arg0) {
            const ret = arg0.tiltX;
            return ret;
        },
        __wbg_tiltY_8c506ba1e73a260b: function(arg0) {
            const ret = arg0.tiltY;
            return ret;
        },
        __wbg_time_1419a960a4b6d84f: function(arg0) {
            const ret = arg0.time;
            return ret;
        },
        __wbg_timeout_8d493cfe43766b2c: function(arg0) {
            const ret = AbortSignal.timeout(arg0);
            return ret;
        },
        __wbg_top_e647a4c02850ada7: function(arg0) {
            const ret = arg0.top;
            return ret;
        },
        __wbg_touches_bafab24f87086f07: function(arg0) {
            const ret = arg0.touches;
            return ret;
        },
        __wbg_transaction_b7261fed68fa4264: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = arg0.transaction(getStringFromWasm0(arg1, arg2), __wbindgen_enum_IdbTransactionMode[arg3]);
            return ret;
        }, arguments); },
        __wbg_transcript_89460a33563142b5: function(arg0, arg1) {
            const ret = arg1.transcript;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_twist_ffb4f2fbd4bbd5af: function(arg0) {
            const ret = arg0.twist;
            return ret;
        },
        __wbg_type_5a96eb5991198f10: function(arg0, arg1) {
            const ret = arg1.type;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_type_7fee727610464e22: function(arg0, arg1) {
            const ret = arg1.type;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_type_ab6d9f8e61816051: function(arg0, arg1) {
            const ret = arg1.type;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_update_memory_4060a0ab30633318: function(arg0, arg1) {
            arg0.update_memory(arg1);
        },
        __wbg_url_1a5ea6a8a7f22ff8: function(arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_url_f1cddff1f5b9519a: function(arg0, arg1) {
            const ret = arg1.url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_6cc2e59057b00287: function(arg0, arg1) {
            const ret = arg1.value;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_9cc0518af87a489c: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbg_value_bfbe8f2b86b7ad71: function(arg0, arg1) {
            const ret = arg1.value;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_value_e81c1bd7c35c746a: function(arg0, arg1) {
            const ret = arg1.value;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_warn_c4e0780980765a86: function(arg0) {
            console.warn(arg0);
        },
        __wbg_weak_76ec38e642028ca7: function(arg0) {
            const ret = arg0.weak();
            return ret;
        },
        __wbg_webapp_new: function(arg0) {
            const ret = WebApp.__wrap(arg0);
            return ret;
        },
        __wbg_width_1a5cec2cda264d4f: function(arg0) {
            const ret = arg0.width;
            return ret;
        },
        __wbg_width_2c6cd071c3b189e3: function(arg0) {
            const ret = arg0.width;
            return ret;
        },
        __wbg_width_4a003cfb3942dad2: function(arg0) {
            const ret = arg0.width;
            return ret;
        },
        __wbg_x_c8067d296258a759: function(arg0) {
            const ret = arg0.x;
            return ret;
        },
        __wbg_y_f72f867ca1895c72: function(arg0) {
            const ret = arg0.y;
            return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 2088, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h13b19743bd48aaa4);
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 2372, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h6e2fa065d9a84d5c);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("Event")], shim_idx: 1529, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h438900c14b0aa173);
            return ret;
        },
        __wbindgen_cast_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("KeyboardEvent")], shim_idx: 1089, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha2ffa317af934624);
            return ret;
        },
        __wbindgen_cast_0000000000000005: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 2088, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__h13b19743bd48aaa4_4);
            return ret;
        },
        __wbindgen_cast_0000000000000006: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("SpeechRecognitionEvent")], shim_idx: 1089, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha2ffa317af934624_5);
            return ret;
        },
        __wbindgen_cast_0000000000000007: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Ref(NamedExternref("Event"))], shim_idx: 1531, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
            const ret = makeClosure(arg0, arg1, wasm_bindgen__convert__closures________invoke__hf9aaf8b7eeb4e213);
            return ret;
        },
        __wbindgen_cast_0000000000000008: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 1533, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, wasm_bindgen__convert__closures_____invoke__ha2b3804c152cb99e);
            return ret;
        },
        __wbindgen_cast_0000000000000009: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_000000000000000a: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_000000000000000b: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_000000000000000c: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./ui_bg.js": import0,
        "./snippets/adapters_web-c6ebf9abec03fbbe/src/c2w.js": import1,
        "./snippets/adapters_web-c6ebf9abec03fbbe/src/cheerpx.js": import2,
    };
}

function wasm_bindgen__convert__closures_____invoke__ha2b3804c152cb99e(arg0, arg1) {
    wasm.wasm_bindgen__convert__closures_____invoke__ha2b3804c152cb99e(arg0, arg1);
}

function wasm_bindgen__convert__closures_____invoke__h13b19743bd48aaa4(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h13b19743bd48aaa4(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h438900c14b0aa173(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h438900c14b0aa173(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__ha2ffa317af934624(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__ha2ffa317af934624(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h13b19743bd48aaa4_4(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__h13b19743bd48aaa4_4(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__ha2ffa317af934624_5(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures_____invoke__ha2ffa317af934624_5(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures________invoke__hf9aaf8b7eeb4e213(arg0, arg1, arg2) {
    wasm.wasm_bindgen__convert__closures________invoke__hf9aaf8b7eeb4e213(arg0, arg1, arg2);
}

function wasm_bindgen__convert__closures_____invoke__h6e2fa065d9a84d5c(arg0, arg1, arg2) {
    const ret = wasm.wasm_bindgen__convert__closures_____invoke__h6e2fa065d9a84d5c(arg0, arg1, arg2);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}

function wasm_bindgen__convert__closures_____invoke__h2d137bb2853bc8bb(arg0, arg1, arg2, arg3) {
    wasm.wasm_bindgen__convert__closures_____invoke__h2d137bb2853bc8bb(arg0, arg1, arg2, arg3);
}


const __wbindgen_enum_IdbTransactionMode = ["readonly", "readwrite", "versionchange", "readwriteflush", "cleanup"];


const __wbindgen_enum_RequestCache = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"];


const __wbindgen_enum_ScrollBehavior = ["auto", "instant", "smooth"];


const __wbindgen_enum_ScrollLogicalPosition = ["start", "center", "end", "nearest"];


const __wbindgen_enum_ScrollRestoration = ["auto", "manual"];


const __wbindgen_enum_WorkerType = ["classic", "module"];
const AgentWorkerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_agentworker_free(ptr, 1));
const JSOwnerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsowner_free(ptr, 1));
const WebAppFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_webapp_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_destroy_closure(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        try {
            return f(state.a, state.b, ...args);
        } finally {
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_destroy_closure(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('ui_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
