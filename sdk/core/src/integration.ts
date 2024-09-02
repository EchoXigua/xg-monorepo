import type {
  Client,
  Event,
  EventHint,
  Integration,
  IntegrationFn,
  Options,
} from '@xigua-monitor/types';
import { arrayify, logger } from '@xigua-monitor/utils';

/**
 * Define an integration function that can be used to create an integration instance.
 * Note that this by design hides the implementation details of the integration, as they are considered internal.
 */
export function defineIntegration<Fn extends IntegrationFn>(
  fn: Fn,
): (...args: Parameters<Fn>) => Integration {
  return fn;
}

/**
 * 该函数用于从给定的 integrations 数组中移除重复项，并优先保留数组中较后出现的集成。
 * 尤其是当同一类型的集成存在多个实例时，用户定义的实例优先于默认实例。
 *
 * @private
 */
function filterDuplicates(integrations: Integration[]): Integration[] {
  // 用来存储每种集成的最后一个实例
  const integrationsByName: { [key: string]: Integration } = {};

  integrations.forEach((currentInstance) => {
    // 获取当前实例的名称
    const { name } = currentInstance;

    const existingInstance = integrationsByName[name];

    // 我们希望数组中后面的集成覆盖先前的相同类型的集成，但我们永远不希望默认实例覆盖现有的用户实例
    if (
      // 如果一个集成对象已经存在且不是默认实例，而当前实例是默认实例，则默认实例不会覆盖用户定义的实例
      existingInstance &&
      !existingInstance.isDefaultInstance &&
      currentInstance.isDefaultInstance
    ) {
      return;
    }

    // 覆盖
    integrationsByName[name] = currentInstance;
  });

  // 通过 Object.values 将字典中的集成对象转化为数组，这样就移除了重复项。
  return Object.values(integrationsByName);
}

/**
 * 这个函数返回一个最终需要设置的 Integration 对象数组，它综合了默认集成和用户提供的集成。
 */
export function getIntegrationsToSetup(
  options: Pick<Options, 'defaultIntegrations' | 'integrations'>,
): Integration[] {
  // 默认集成
  const defaultIntegrations = options.defaultIntegrations || [];
  // 用户提供的集成
  const userIntegrations = options.integrations;

  // 将默认集成标记为默认实例
  defaultIntegrations.forEach((integration) => {
    integration.isDefaultInstance = true;
  });

  let integrations: Integration[];

  // 数组，直接将其与 defaultIntegrations 合并
  if (Array.isArray(userIntegrations)) {
    integrations = [...defaultIntegrations, ...userIntegrations];
  } else if (typeof userIntegrations === 'function') {
    // 是函数，调用该函数并传入 defaultIntegrations，然后将返回的结果转为数组。
    integrations = arrayify(userIntegrations(defaultIntegrations));
  } else {
    //  未定义，则仅使用 默认集成
    integrations = defaultIntegrations;
  }

  // 移除重复的集成
  const finalIntegrations = filterDuplicates(integrations);

  // The `Debug` integration prints copies of the `event` and `hint` which will be passed to `beforeSend` or
  // `beforeSendTransaction`. It therefore has to run after all other integrations, so that the changes of all event
  // processors will be reflected in the printed values. For lack of a more elegant way to guarantee that, we therefore
  // locate it and, assuming it exists, pop it out of its current spot and shove it onto the end of the array.

  // 为了确保 Debug 集成可以记录所有其它集成的结果，
  // 如果 finalIntegrations 中存在名为 Debug 的集成，则将其移动到数组末尾
  const debugIndex = finalIntegrations.findIndex(
    (integration) => integration.name === 'Debug',
  );
  if (debugIndex > -1) {
    const [debugInstance] = finalIntegrations.splice(debugIndex, 1) as [
      Integration,
    ];
    finalIntegrations.push(debugInstance);
  }

  // 返回最终的 Integration 数组
  return finalIntegrations;
}
