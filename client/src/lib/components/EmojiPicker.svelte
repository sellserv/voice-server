<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import data from '@emoji-mart/data';
  import { api } from '$lib/api';
  import { resolveAsset } from '$lib/stores/server';
  import { getActiveServerId } from '$lib/stores/servers';

  let { onSelect }: { onSelect: (native: string) => void } = $props();

  let container: HTMLDivElement;
  let picker: any;

  // Separate lookup map for raw paths — kept outside emoji-mart's objects
  const rawSrcMap = new Map<string, string>();

  onMount(async () => {
    // Fetch custom emojis for the active server
    let customEmojis: any[] = [];
    try {
      const serverId = getActiveServerId();
      const emojis = serverId
        ? await api.get<any[]>(`/api/servers/${serverId}/custom-emojis`)
        : [];
      customEmojis = emojis.map((e) => {
        rawSrcMap.set(e.name, `/uploads/${e.stored_name}`);
        return {
          id: e.name,
          name: e.name,
          keywords: [e.name],
          skins: [{ src: resolveAsset(`/uploads/${e.stored_name}`) }],
        };
      });
    } catch {
      // ignore
    }

    const { Picker } = await import('emoji-mart');
    const pickerOpts: any = {
      data,
      theme: 'dark',
      onEmojiSelect: (emoji: any) => {
        if (emoji.src) {
          // Custom emoji — use raw /uploads/ path so the renderer regex can match
          const src = rawSrcMap.get(emoji.id) || emoji.src;
          onSelect(`<:${emoji.id}:${src}>`);
        } else {
          onSelect(emoji.native);
        }
      },
    };

    if (customEmojis.length > 0) {
      pickerOpts.custom = [
        {
          id: 'custom',
          name: 'Custom',
          emojis: customEmojis,
        },
      ];
    }

    picker = new Picker(pickerOpts);
    container.appendChild(picker as any);
  });

  onDestroy(() => {
    if (picker && container?.contains(picker as any)) {
      container.removeChild(picker as any);
    }
  });
</script>

<div class="emoji-popover" bind:this={container}></div>

<style>
  .emoji-popover {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin-bottom: 8px;
    z-index: 100;
    max-width: calc(100vw - 16px);
  }
</style>
