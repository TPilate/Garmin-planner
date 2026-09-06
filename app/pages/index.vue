<script setup lang="ts">
// Redirect to the current month's grid — the app's only real landing view.
const now = new Date()
await navigateTo(`/roster/${now.getFullYear()}/${now.getMonth() + 1}`, { replace: true })
</script>

<template />
