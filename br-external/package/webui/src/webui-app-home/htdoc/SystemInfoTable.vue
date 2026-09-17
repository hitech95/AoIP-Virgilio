/*
 * SystemInfoTable -- the board/system descriptions block of the overview
 * page (kernel, model, hostname, uptime extracted by the parent).
 */
<template>
  <el-descriptions :title="$t('System')" border :column="1">
    <el-descriptions-item v-for="item in rows" :key="item[0]" :label="$t(item[0])">
      {{ item[1] }}
    </el-descriptions-item>
  </el-descriptions>
</template>

<script>
export default {
  props: {
    rows: { type: Array, default: () => [] }
  }
}
</script>
