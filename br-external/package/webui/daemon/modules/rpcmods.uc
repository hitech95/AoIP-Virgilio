/* rpcmods -- merge the module families into the frozen contract table
 * (plan/webui.md §4). Object spread works in the pinned ucode rev. */

import { core_modules } from "mods_core";
import { uci_module } from "mods_uci";
import { dsp_modules } from "mods_dsp";
import { webui_module } from "mods_webui";
import { files_module } from "mods_files";

const rpc_modules = {
	...core_modules,
	uci: uci_module,
	...dsp_modules,
	...files_module,
	webui: webui_module
};

export { rpc_modules };
