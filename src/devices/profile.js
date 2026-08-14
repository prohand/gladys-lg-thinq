// -----------------------------------------------------------------------------
// LG ThinQ profile & state flattening.
//
// `GET /devices/{id}/profile` describes what an appliance exposes, and
// `GET /devices/{id}/state` carries the matching values. Both use the same
// nested shape, in one of three layouts:
//
//   1. plain            { "operation": { "airConOperationMode": {...} } }
//   2. per-resource list { "temperatureInUnits": [ { "locationName": "FRIDGE", ... } ] }
//   3. per-device list   [ { "location": { "locationName": "MAIN" }, "runState": {...} } ]
//
// Layout 2 is how a fridge exposes its compartments, layout 3 how a washtower
// exposes its washer and its dryer. Rather than special-casing 30 appliance
// families, this module flattens all three into ONE list of property
// descriptors — `resource[.location].property` — which the feature mapper then
// turns into Gladys features. That is what lets the integration support an
// appliance LG adds after this code was written.
// -----------------------------------------------------------------------------

/** Property spec, as found in the profile. */
const READ_MODE = 'r';
const WRITE_MODE = 'w';

/** kebab-case, safe for a Gladys external id (no colon, no space). */
export function toKey(value) {
  return String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "targetTemperatureC" -> "Target temperature c" (fallback feature name). */
export function humanize(value) {
  const words = toKey(value).split('-').filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Split a profile/state root into `{ location, resources }` blocks.
 * Handles layout 3 (a list of per-location blocks) and layouts 1-2 (a plain
 * object, no location at the root).
 */
function splitLocationBlocks(root) {
  if (Array.isArray(root)) {
    return root
      .filter((block) => block && typeof block === 'object')
      .map((block) => {
        const { location, ...resources } = block;
        return { location: location?.locationName ?? null, resources };
      });
  }
  if (root && typeof root === 'object') {
    return [{ location: null, resources: root }];
  }
  return [];
}

/**
 * Split one resource value into `{ location, properties }` entries. Handles
 * layout 2 (a list of per-compartment objects carrying `locationName`).
 */
function splitResourceEntries(resourceValue, inheritedLocation) {
  if (Array.isArray(resourceValue)) {
    return resourceValue
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => {
        const { locationName, ...properties } = entry;
        return { location: locationName ?? inheritedLocation, properties };
      });
  }
  if (resourceValue && typeof resourceValue === 'object') {
    return [{ location: inheritedLocation, properties: resourceValue }];
  }
  return [];
}

/**
 * Read one property spec. A spec is either a bare constant string (read-only
 * value baked into the profile) or an object describing type, access mode and
 * accepted values.
 */
function describeSpec(spec, resourceUnit) {
  if (typeof spec === 'string') {
    return {
      valueType: 'string',
      readable: true,
      writable: false,
      readValues: [spec],
      writeValues: [],
      unit: resourceUnit ?? null,
    };
  }
  if (!spec || typeof spec !== 'object') {
    return null;
  }
  const modes = Array.isArray(spec.mode) ? spec.mode : [];
  return {
    valueType: spec.type ?? 'unknown',
    readable: modes.includes(READ_MODE),
    writable: modes.includes(WRITE_MODE),
    readValues: spec.value?.[READ_MODE] ?? null,
    writeValues: spec.value?.[WRITE_MODE] ?? null,
    unit: spec.unit ?? resourceUnit ?? null,
  };
}

/**
 * Flatten a device profile into a list of property descriptors.
 *
 * @param {object|Array} profile the `response` of GET /devices/{id}/profile
 * @returns {Array<object>} descriptors, in profile order
 */
export function flattenProfile(profile) {
  const descriptors = [];
  const seen = new Set();

  for (const block of splitLocationBlocks(profile?.property)) {
    for (const [resource, resourceValue] of Object.entries(block.resources)) {
      for (const entry of splitResourceEntries(resourceValue, block.location)) {
        // A resource-level `unit` applies to every property that has none.
        const resourceUnit =
          typeof entry.properties.unit === 'string' ? entry.properties.unit : null;

        for (const [property, spec] of Object.entries(entry.properties)) {
          const described = describeSpec(spec, resourceUnit);
          if (!described || (!described.readable && !described.writable)) {
            continue;
          }
          const key = [
            toKey(resource),
            entry.location ? toKey(entry.location) : null,
            toKey(property),
          ]
            .filter(Boolean)
            .join('-');
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          descriptors.push({
            key,
            path: `${resource}.${property}`,
            resource,
            property,
            location: entry.location,
            ...described,
          });
        }
      }
    }
  }

  return descriptors;
}

/**
 * Read the value of a descriptor in a device state payload.
 * Returns `undefined` when the appliance did not report that property.
 */
export function readStateValue(state, descriptor) {
  for (const block of splitLocationBlocks(state)) {
    // A per-device block only answers for its own location.
    if (
      block.location !== null &&
      descriptor.location !== null &&
      block.location !== descriptor.location
    ) {
      continue;
    }
    const resourceValue = block.resources?.[descriptor.resource];
    for (const entry of splitResourceEntries(resourceValue, block.location)) {
      if (descriptor.location !== null && entry.location !== descriptor.location) {
        continue;
      }
      if (descriptor.property in entry.properties) {
        return entry.properties[descriptor.property];
      }
    }
  }
  return undefined;
}

/**
 * Build the control payload for one property, in the shape LG expects.
 * Compartment-scoped properties (a fridge drawer) carry their `locationName`.
 */
export function buildControlPayload(descriptor, value) {
  const inner = { [descriptor.property]: value };
  if (descriptor.location) {
    return { [descriptor.resource]: { locationName: descriptor.location, ...inner } };
  }
  return { [descriptor.resource]: inner };
}
