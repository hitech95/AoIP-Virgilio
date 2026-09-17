<template>
  <div v-if="channels.length" class="channel-row">
    <span class="channel-label">{{ label }}</span>
    <el-tag v-for="channel in channels" :key="channel" size="small" effect="plain" :class="`channel-${channel}`">Ch {{ channel }}</el-tag>
  </div>
</template>

<script>
export default { props: { label: String, channels: { type: Array, default: () => [] } } }
</script>
