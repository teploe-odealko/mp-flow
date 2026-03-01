<script setup lang="ts">
import TheSidebar from './TheSidebar.vue'
import MobileSidebarOverlay from './MobileSidebarOverlay.vue'
import TheMobileTopbar from './TheMobileTopbar.vue'
import SectionHeader from './SectionHeader.vue'
import TheToastContainer from './TheToastContainer.vue'
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <TheSidebar />
    <MobileSidebarOverlay />

    <div class="flex-1 flex flex-col overflow-hidden lg:ml-60">
      <TheMobileTopbar />
      <main class="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 dark:bg-slate-950">
        <SectionHeader />
        <router-view />
      </main>
    </div>
  </div>

  <TheToastContainer />
</template>
