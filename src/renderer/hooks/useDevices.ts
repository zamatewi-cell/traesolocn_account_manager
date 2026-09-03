import { useState, useEffect, useCallback } from 'react';
import type { DeviceItem } from '../../shared/types';

/**
 * 设备池 Hook，支持全局设备列表获取与实时事件同步监听
 */
export function useDevices() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI.devices.list();
      if (result.success && result.data) {
        setDevices(result.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDevices();
    const unsubscribe = window.electronAPI.devices.onDevicesUpdated(() => {
      loadDevices();
    });
    return () => {
      unsubscribe?.();
    };
  }, [loadDevices]);

  return { devices, loading, loadDevices, setDevices };
}
