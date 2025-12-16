import toast from 'react-hot-toast';

/**
 * Toast notification wrapper that respects user preferences
 *
 * Usage:
 * ```typescript
 * import { showToast } from '@/utils/toast';
 *
 * showToast.error('Something went wrong');
 * showToast.success('Saved successfully');
 * ```
 */

// Get settings from localStorage
const getSettings = () => {
  try {
    const stored = localStorage.getItem('notificationSettings');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Fall through to defaults
  }
  return {
    showErrorToasts: true,
    showSuccessToasts: true,
    showInfoToasts: true,
  };
};

export const showToast = {
  error: (message: string, options?: Parameters<typeof toast.error>[1]) => {
    const settings = getSettings();
    if (settings.showErrorToasts) {
      return toast.error(message, options);
    }
  },

  success: (message: string, options?: Parameters<typeof toast.success>[1]) => {
    const settings = getSettings();
    if (settings.showSuccessToasts) {
      return toast.success(message, options);
    }
  },

  info: (message: string, options?: Parameters<typeof toast>[1]) => {
    const settings = getSettings();
    if (settings.showInfoToasts) {
      return toast(message, options);
    }
  },

  // Always show loading toasts (they're dismissible)
  loading: toast.loading,
  dismiss: toast.dismiss,
};
