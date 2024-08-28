import { DataSource } from 'typeorm';

export default new DataSource({
  type: 'mysql', //数据库类型
  username: 'root', //账号
  password: 'Yuan1101', //密码
  host: '43.139.245.195', //host
  port: 3306, //
  database: 'test', //库名
  //数据库迁移
  /**
   * npx typeorm-ts-node-esm migration:run
   */
  entities: ['dist/**/*.entity.js'],
  migrations: ['dist/migrations/*.js'],
});
