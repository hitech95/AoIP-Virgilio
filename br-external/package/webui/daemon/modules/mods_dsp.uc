/* mods_dsp -- the filters/mix RPC surface over dsp.uc (protected
 * pipeline: manifest-driven slots, plan/webui.md §9). */

import { filters_schema, filters_set,
	dsp_settings_get, dsp_settings_set, dsp_pipeline_get } from "dsp";
import { ubus_call } from "ubusx";
import { ERR_UNKNOWN } from "util";

const dsp_modules = {
	dsp: {
		status: (params) => ubus_call("camilladsp", "status") ??
			{ error: { code: ERR_UNKNOWN, message: "camilladsp not reachable" } },
		get_settings: (params) => dsp_settings_get(),
		save_settings: (params) => dsp_settings_set(params?.settings ?? {}),
		get_saved_filters: (params) => filters_schema(),
		save_filters: (params) => filters_set(params ?? {}),
		get_pipeline: (params) => dsp_pipeline_get()
	}
};

export { dsp_modules };
