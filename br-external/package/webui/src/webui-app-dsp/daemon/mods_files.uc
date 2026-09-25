/* mods_files -- the files RPC surface (uploads land via handle_upload
 * in filesx, which the router wires to /oui-upload). */

import { files_list, files_delete, files_read, files_write } from "filesx";

const files_module = {
	files: {
		list: (params) => files_list(),
		read: (params) => files_read(params),
		write: (params) => files_write(params),
		"delete": (params) => files_delete(params)
	}
};

export { files_module };
