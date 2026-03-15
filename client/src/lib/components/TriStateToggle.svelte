<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    value,
    onchange,
    disabled = false,
  }: {
    value: boolean | null | undefined;
    onchange: (newValue: boolean | null) => void;
    disabled?: boolean;
  } = $props();

  function select(newValue: boolean | null) {
    if (disabled) return;
    onchange(newValue);
  }
</script>

<div class="tri-state-toggle" class:disabled>
  <button
    class="toggle-option deny"
    class:active={value === false}
    onclick={() => select(value === false ? null : false)}
    title="Deny"
    type="button"
  >
    <Icon name="x" size={14} strokeWidth={3} />
  </button>
  <button
    class="toggle-option inherit"
    class:active={value === null || value === undefined}
    onclick={() => select(null)}
    title="Inherit"
    type="button"
  >
    <div class="inherit-dash"></div>
  </button>
  <button
    class="toggle-option allow"
    class:active={value === true}
    onclick={() => select(value === true ? null : true)}
    title="Allow"
    type="button"
  >
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
    >
  </button>
</div>

<style>
  .tri-state-toggle {
    display: flex;
    background: var(--bg-darkest);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 2px;
    width: fit-content;
    transition: all 150ms var(--ease-out);
  }

  .tri-state-toggle:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  .toggle-option {
    width: 32px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-dim);
    cursor: pointer;
    border-radius: 12px;
    transition: all 150ms var(--ease-out);
    padding: 0;
  }

  .toggle-option:hover:not(.active) {
    color: var(--text);
    background: var(--bg-hover);
  }

  .toggle-option.active {
    color: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  .toggle-option.deny.active {
    background: var(--danger);
  }

  .toggle-option.inherit.active {
    background: var(--bg-light);
    color: var(--text);
  }

  .toggle-option.allow.active {
    background: var(--success);
  }

  .inherit-dash {
    width: 10px;
    height: 2px;
    background: currentColor;
    border-radius: 1px;
  }

  .disabled {
    opacity: 0.5;
    pointer-events: none;
  }
</style>
