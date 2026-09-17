/*
 * NetworkInfoTable -- one management-LAN interface as descriptions rows
 * (fed by webuid's network.get_lan_networks -> ubus lan status).
 */
<template>
  <el-descriptions :title="$t('Management LAN')" border :column="1">
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
