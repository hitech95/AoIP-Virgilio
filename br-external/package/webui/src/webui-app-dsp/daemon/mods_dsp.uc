/* mods_dsp -- BE module of webui-app-dsp: the generic/basic DSP
 * configuration surface. The FE modules webui-app-{eq,pipeline,filters}
 * depend on this module (see dsp.uc).
 *
 * Built over dsp.uc (protected pipeline: manifest-driven slots,
 * plan/webui.md §9). */

import { filters_schema, filters_set, mix_set, mixers_get, mix_set_gains, mix_set_meta, block_set_label,
	dsp_settings_get, dsp_settings_set, dsp_pipeline_get } from "dsp";
import { ubus_call } from "ubusx";
import { ERR_UNKNOWN } from "util";

const dsp_modules = {
	dsp: {
		status: (params) => ubus_call("camilladsp", "status") ??
			{ error: { code: ERR_UNKNOWN, message: "camilladsp not reachable" } },
		volume_set: (params) => {
			let r = ubus_call("camilladsp", "volume_set",
				{ volume: params?.volume ?? 0 });
			return (r == null)
				? { error: { code: ERR_UNKNOWN, message: "camilladsp not reachable" } }
				: (r ?? {});
		},
		get_settings: (params) => dsp_settings_get(),
		save_settings: (params) => dsp_settings_set(params?.settings ?? {}),
		get_saved_filters: (params) => filters_schema(),
		save_filters: (params) => filters_set(params ?? {}),
		get_pipeline: (params) => dsp_pipeline_get(),
		/* mixer tab: quick presets (source) or manual route gains */
		get_mixers: (params) => mixers_get(),
		save_mixer_meta: (params) => mix_set_meta(params),
		set_block_label: (params) => block_set_label(params),
		save_mixer: (params) => (params?.routes != null)
			? mix_set_gains(params) : mix_set(params)
	}
};

export { dsp_modules };
