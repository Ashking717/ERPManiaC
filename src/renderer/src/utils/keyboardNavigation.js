function isKeyboardEventModified(event) {
  return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}

function isSkippableInputType(type) {
  return ['checkbox', 'radio', 'button', 'submit', 'reset', 'file'].includes(String(type || '').toLowerCase());
}

export function focusElement(element) {
  if (!element || typeof element.focus !== 'function') {
    return;
  }

  element.focus();

  if (typeof element.select === 'function' && 'value' in element && !isSkippableInputType(element.type)) {
    element.select();
  }
}

export function handleSequentialEnter(event, containerRef, { onComplete } = {}) {
  if (event.key !== 'Enter' || isKeyboardEventModified(event)) {
    return false;
  }

  const target = event.target;
  if (!target || target.tagName === 'TEXTAREA' || isSkippableInputType(target.type)) {
    return false;
  }

  const container = containerRef?.current || target.closest('[data-enter-nav-root]');
  if (!container) {
    return false;
  }

  const elements = [...container.querySelectorAll('[data-enter-nav]')].filter(
    (element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true'
  );
  const currentIndex = elements.indexOf(target);
  if (currentIndex === -1) {
    return false;
  }

  event.preventDefault();

  const nextElement = elements[currentIndex + 1];
  if (nextElement) {
    requestAnimationFrame(() => focusElement(nextElement));
    return true;
  }

  if (typeof onComplete === 'function') {
    onComplete();
    return true;
  }

  return false;
}

export function handleShortcutKey(event, { onSubmit, onEscape } = {}) {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && typeof onSubmit === 'function') {
    event.preventDefault();
    onSubmit();
    return true;
  }

  if (event.key === 'Escape' && !isKeyboardEventModified(event) && typeof onEscape === 'function') {
    event.preventDefault();
    onEscape();
    return true;
  }

  return false;
}
