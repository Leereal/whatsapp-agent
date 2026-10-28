import { useEffect, useState } from "react";
import type { WxtStorageItem } from "wxt/utils/storage";

/** Current value of a storage item, updated live when anything changes it */
export function useStorageItem<T>(item: WxtStorageItem<T, Record<string, unknown>>): {
  value: T | undefined;
  loaded: boolean;
} {
  const [state, setState] = useState<{ value: T | undefined; loaded: boolean }>({
    value: undefined,
    loaded: false,
  });

  useEffect(() => {
    let active = true;
    void item.getValue().then((value) => {
      if (active) setState({ value, loaded: true });
    });
    const unwatch = item.watch((value) => setState({ value, loaded: true }));
    return () => {
      active = false;
      unwatch();
    };
  }, [item]);

  return state;
}
