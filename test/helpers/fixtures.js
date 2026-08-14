// -----------------------------------------------------------------------------
// ThinQ payload fixtures, trimmed to what the mapping actually reads.
//
// The three appliances below are not arbitrary: they cover the three profile
// layouts the API uses (plain, per-resource list, per-device list), which is
// where the mapping is most likely to break.
// -----------------------------------------------------------------------------

/** Air conditioner: the plain layout, no location anywhere. */
export const AIR_CONDITIONER = {
  device: {
    deviceId: 'TQS-AC-0001',
    deviceInfo: {
      deviceType: 'DEVICE_AIR_CONDITIONER',
      modelName: 'PAC_056905_WW',
      alias: 'Salon',
      reportable: true,
    },
  },
  profile: {
    property: {
      airConJobMode: {
        currentJobMode: {
          type: 'enum',
          mode: ['r', 'w'],
          value: { r: ['COOL', 'HEAT', 'AIR_DRY'], w: ['COOL', 'HEAT', 'AIR_DRY'] },
        },
      },
      operation: {
        airConOperationMode: {
          type: 'enum',
          mode: ['r', 'w'],
          value: { r: ['POWER_ON', 'POWER_OFF'], w: ['POWER_ON', 'POWER_OFF'] },
        },
      },
      temperatureInUnits: {
        currentTemperatureC: { type: 'number', mode: ['r'], unit: 'C' },
        currentTemperatureF: { type: 'number', mode: ['r'], unit: 'F' },
        targetTemperatureC: {
          type: 'range',
          mode: ['r', 'w'],
          value: { r: { min: 18, max: 30, step: 1 }, w: { min: 18, max: 30, step: 1 } },
          unit: 'C',
        },
        targetTemperatureF: {
          type: 'range',
          mode: ['r', 'w'],
          value: { r: { min: 64, max: 86, step: 1 }, w: { min: 64, max: 86, step: 1 } },
          unit: 'F',
        },
        unit: { type: 'enum', mode: ['r'], value: { r: ['C', 'F'] } },
      },
      airFlow: {
        windStrength: {
          type: 'enum',
          mode: ['r', 'w'],
          value: { r: ['LOW', 'MID', 'HIGH'], w: ['LOW', 'MID', 'HIGH'] },
        },
      },
      airQualitySensor: {
        PM2: { type: 'number', mode: ['r'] },
        PM10: { type: 'number', mode: ['r'] },
        humidity: { type: 'number', mode: ['r'] },
        monitoringEnabled: {
          type: 'enum',
          mode: ['r', 'w'],
          value: { r: ['ON', 'OFF'], w: ['ON', 'OFF'] },
        },
      },
      timer: {
        absoluteHourToStart: {
          type: 'range',
          mode: ['r', 'w'],
          value: { r: { min: 0, max: 23 }, w: { min: 0, max: 23 } },
        },
      },
      filterInfo: {
        filterRemainPercent: { type: 'number', mode: ['r'] },
      },
    },
  },
  state: {
    airConJobMode: { currentJobMode: 'COOL' },
    operation: { airConOperationMode: 'POWER_ON' },
    temperatureInUnits: {
      currentTemperatureC: 24.5,
      currentTemperatureF: 76.1,
      targetTemperatureC: 21,
      targetTemperatureF: 70,
      unit: 'C',
    },
    airFlow: { windStrength: 'MID' },
    airQualitySensor: { PM2: 12, PM10: 20, humidity: 47, monitoringEnabled: 'ON' },
    timer: { absoluteHourToStart: 0 },
    filterInfo: { filterRemainPercent: 82 },
  },
};

/** Refrigerator: per-resource lists keyed by `locationName`. */
export const REFRIGERATOR = {
  device: {
    deviceId: 'TQS-FRIDGE-0002',
    deviceInfo: {
      deviceType: 'DEVICE_REFRIGERATOR',
      modelName: 'GBB92MCBAP',
      alias: 'Cuisine',
      reportable: true,
    },
  },
  profile: {
    property: {
      powerSave: {
        powerSaveEnabled: {
          type: 'boolean',
          mode: ['r', 'w'],
          value: { r: [true, false], w: [true, false] },
        },
      },
      doorStatus: [
        {
          locationName: 'MAIN',
          doorState: { type: 'enum', mode: ['r'], value: { r: ['OPEN', 'CLOSE'] } },
        },
      ],
      temperatureInUnits: [
        {
          locationName: 'FRIDGE',
          targetTemperatureC: {
            type: 'range',
            mode: ['r', 'w'],
            value: { r: { min: 1, max: 7 }, w: { min: 1, max: 7 } },
            unit: 'C',
          },
        },
        {
          locationName: 'FREEZER',
          targetTemperatureC: {
            type: 'range',
            mode: ['r', 'w'],
            value: { r: { min: -23, max: -15 }, w: { min: -23, max: -15 } },
            unit: 'C',
          },
        },
      ],
    },
  },
  state: {
    powerSave: { powerSaveEnabled: false },
    doorStatus: [{ locationName: 'MAIN', doorState: 'CLOSE' }],
    temperatureInUnits: [
      { locationName: 'FRIDGE', targetTemperatureC: 3 },
      { locationName: 'FREEZER', targetTemperatureC: -18 },
    ],
  },
};

/** Washtower: the top-level list, one block per sub-appliance. */
export const WASHTOWER = {
  device: {
    deviceId: 'TQS-WT-0003',
    deviceInfo: {
      deviceType: 'DEVICE_WASHTOWER',
      modelName: 'WT1210',
      alias: 'Buanderie',
      reportable: true,
    },
  },
  profile: {
    property: [
      {
        location: { locationName: 'WASHER' },
        runState: {
          currentState: {
            type: 'enum',
            mode: ['r'],
            value: { r: ['RUNNING', 'END', 'POWER_OFF'] },
          },
        },
        operation: {
          washerOperationMode: {
            type: 'enum',
            mode: ['w'],
            value: { w: ['START', 'STOP', 'WAKE_UP'] },
          },
        },
        timer: {
          remainHour: { type: 'range', mode: ['r'], value: { r: { min: 0, max: 12 } } },
          remainMinute: { type: 'range', mode: ['r'], value: { r: { min: 0, max: 59 } } },
        },
      },
      {
        location: { locationName: 'DRYER' },
        runState: {
          currentState: {
            type: 'enum',
            mode: ['r'],
            value: { r: ['RUNNING', 'END', 'POWER_OFF'] },
          },
        },
      },
    ],
  },
  state: [
    {
      location: { locationName: 'WASHER' },
      runState: { currentState: 'RUNNING' },
      timer: { remainHour: 1, remainMinute: 25 },
    },
    { location: { locationName: 'DRYER' }, runState: { currentState: 'END' } },
  ],
};
