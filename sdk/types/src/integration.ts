import type { Client } from './client';
import type { Event, EventHint } from './event';

/**
 * 定义了一个集成类的基本形态，要求实现此接口的类必须包含一个 id 属性，并且能够通过构造函数创建一个对象实例
 */
export interface IntegrationClass<T> {
  /**
   * 表示集成的唯一标识符（通常是集成的名称）
   */
  id: string;

  /**
   * 这是 TypeScript 中的一种构造函数签名，表示这个接口可以被实例化为一个对象，
   * 并且构造函数可以接收任意数量和类型的参数。T 是泛型类型，表示这个类实例化后生成的对象类型。
   */
  new (...args: any[]): T;
}

/**
 * Sentry 的集成机制允许开发者将特定的功能或行为注入到 SDK 中，以增强错误监控的能力。这些接口和类型描述了集成的基本结构和行为
 */
export interface Integration {
  /**
   * 集成的名称，用于标识这个集成
   */
  name: string;

  /**
   * 这是一个可选的钩子函数，用于在 SDK 初始化时执行一些全局性的设置操作。
   * 该函数只会被调用一次，通常用于全局补丁或类似操作。
   */
  setupOnce?(): void;

  /**
   * 这是另一个可选的钩子函数，用于为每一个客户端设置集成。
   *
   * 相比之下，setup 钩子在每个客户端被创建时都会运行一次。
   * 也就是说，如果在应用中创建了多个 Sentry 客户端实例，那么每个实例都会调用一次 setup。
   *
   * setup 更加适合那些需要针对每个客户端实例进行配置的集成。
   * 例如，如果一个集成需要为每个客户端实例注册特定的行为或进行特定的初始化操作，应该使用 setup。
   *
   *
   * 尽可能地优先使用 setup 而不是 setupOnce。” 这是因为 setup 会为每个客户端实例调用，
   * 能够更灵活地处理每个实例的配置需求，而 setupOnce 仅适合那些需要全局执行且不依赖具体客户端实例的情况。
   * 只有在必须要执行全局性的操作（例如注册全局的事件处理器或全局状态配置）时，才应该使用 setupOnce。
   */
  setup?(client: Client): void;

  /**
   * 这是一个可选钩子函数，在所有集成的 setupOnce 和 setup 都调用完之后触发。如果需要确保其他所有集成都已完成设置，可以使用这个钩子。
   */
  afterAllSetup?(client: Client): void;

  /**
   * 这个可选的钩子函数允许在事件传递给其他处理器之前，对事件进行预处理。它在事件处理流程的早期阶段执行，可以用来修改或过滤事件。
   */
  preprocessEvent?(
    event: Event,
    hint: EventHint | undefined,
    client: Client,
  ): void;

  /**
   * 这个可选的钩子函数允许对事件进行处理。可以返回修改后的事件对象，也可以返回 null 来丢弃事件。
   * 这个钩子比 preprocessEvent 更接近实际发送事件的阶段。
   */
  processEvent?(
    event: Event,
    hint: EventHint,
    client: Client,
  ): Event | null | PromiseLike<Event | null>;
}

/**
 * 这个类型定义了一种集成的函数形式，允许开发者通过函数来创建集成。这种形式的集成创建方式更加灵活。
 */
export type IntegrationFn<IntegrationType = Integration> = (
  ...rest: any[]
) => IntegrationType;
