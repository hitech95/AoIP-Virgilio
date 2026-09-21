/* mods_files -- the files RPC surface (uploads land via handle_upload
 * in filesx, which the router wires to /oui-upload). */

import { files_list, files_delete } from "filesx";

const files_module = {
	files: {
		list: (params) => files_list(),
		"delete": (params) => files_delete(params)
	}
};

export { files_module };
