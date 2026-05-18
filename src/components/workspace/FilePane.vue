<template>
  <div class="file-pane">
    <div class="file-pane__placeholder">
      File preview pane for <strong>{{ fileId }}</strong>.
    </div>
  </div>
</template>

<script setup>
defineProps({
  fileId: {
    type: String,
    default: '',
  },
})
</script>

<style scoped>
.file-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.file-pane__placeholder {
  flex: 1;
  display: grid;
  place-items: center;
  text-align: center;
  color: #91a2bc;
  padding: 1rem;
}
</style>
