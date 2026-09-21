/* rpcmods -- merge the module families into the frozen contract table
 * (plan/webui.md §4). Object spread works in the pinned ucode rev.
 *
 * Composition (source lives next to each FE app; installed flat into
 * /usr/share/webui/ucode/, so import names are unchanged):
 *   daemon/core/            -- core: ui, ubus bridge, uci, webui
 *   src/webui-app-dsp/      -- dsp.* + files.* (generic/basic DSP config,
 *                              profiles storage; the FE modules
 *                              webui-app-dsp (configuration, profiles) and
 *                              webui-app-dsp-live (eq, pipeline) depend on it)
 *   src/webui-app-logs/     -- logs.*
 *   src/webui-app-status/   -- status.*
 *   src/webui-app-netstat/  -- network.* (also used by home)
 *   src/webui-app-home/     -- system.get_cpu_time
 *   src/webui-app-system/   -- system.get_timezones
 *   src/webui-app-inferno/  -- inferno.* (AoIP name/interface)
 */

import { core_modules } from "mods_core";
import { uci_module } from "mods_uci";
import { webui_module } from "mods_webui";
import { dsp_modules } from "mods_dsp";
import { files_module } from "mods_files";
import { logs_module } from "mods_logs";
import { status_module } from "mods_status";
import { netstat_module } from "mods_netstat";
import { home_module } from "mods_home";
import { system_module } from "mods_system";
import { inferno_module } from "mods_inferno";

const rpc_modules = {
	...core_modules,
	uci: uci_module,
	webui: webui_module,
	...dsp_modules,
	...files_module,
	...logs_module,
	...status_module,
	...netstat_module,
	...inferno_module,
	/* home + system share the "system" namespace (get_cpu_time /
	 * get_timezones): shallow spread would drop one side -- merge deep. */
	system: {
		...home_module.system,
		...system_module.system
	}
};

export { rpc_modules };
