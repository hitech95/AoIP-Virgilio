<template>
  <el-button
    class="viz-chip"
    size="small"
    :type="buttonType"
    :plain="!active"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </el-button>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    active?: boolean
    disabled?: boolean
    type?: 'primary' | 'success' | 'warning' | 'danger' | 'info'
  }>(),
  { active: false, disabled: false, type: 'primary' }
)

defineEmits<{ (e: 'click', event: MouseEvent): void }>()

const buttonType = computed(() => (props.active ? props.type : undefined))
</script>
