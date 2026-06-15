const mockData = require('../mocks/mockData');

class MockModel {
  constructor(modelName) {
    this.modelName = modelName;
    // We keep the data in memory for the duration of the process
    if (!global.__mock_data__) {
      global.__mock_data__ = JSON.parse(JSON.stringify(mockData));
    }
  }

  get data() {
    return global.__mock_data__[this.modelName] || [];
  }

  set data(value) {
    global.__mock_data__[this.modelName] = value;
  }

  // Helper to match filter criteria
  _matches(record, filter) {
    if (!filter || Object.keys(filter).length === 0) return true;
    for (const key in filter) {
      if (key === '$or') {
        return filter.$or.some(opt => this._matches(record, opt));
      }
      if (key === '$regex') continue; // Simple mock doesn't support complex regex yet, we skip or do basic match
      
      const filterVal = filter[key];
      const recordVal = record[key];

      if (typeof filterVal === 'object' && filterVal !== null) {
        if (filterVal.$regex) {
          const regex = new RegExp(filterVal.$regex, filterVal.$options || '');
          if (!regex.test(recordVal)) return false;
          continue;
        }
        if (filterVal.$in) {
          if (!filterVal.$in.includes(recordVal)) return false;
          continue;
        }
      }

      // Handle ObjectId vs String comparison
      const rVal = recordVal ? recordVal.toString() : recordVal;
      const fVal = filterVal ? filterVal.toString() : filterVal;

      if (rVal != fVal) return false;
    }
    return true;
  }

  find(filter = {}) {
    const results = this.data.filter(record => this._matches(record, filter));
    
    // Create the results as "documents"
    const docs = results.map(r => this._toDoc(r));

    // Mongoose chaining simulation
    const chain = {
      results: docs,
      sort: () => chain,
      limit: () => chain,
      skip: () => chain,
      populate: () => chain,
      select: () => chain,
      lean: () => docs,
      exec: async () => docs,
      then: (onFullfilled) => Promise.resolve(docs).then(onFullfilled)
    };
    return chain;
  }

  _toDoc(record) {
    if (!record) return null;
    const modelName = this.modelName;
    const doc = {
      ...record,
      save: async function() {
        const index = global.__mock_data__[modelName].findIndex(r => r._id === this._id);
        if (index !== -1) {
          global.__mock_data__[modelName][index] = { ...this };
        }
        return this;
      },
      comparePassword: async function(candidatePassword) {
        // For mock purposes, if it's the default admin, we allow 'admin123'
        // Otherwise, simple string comparison
        if (this.email === 'admin@test.com' && candidatePassword === 'admin123') return true;
        return this.password === candidatePassword || candidatePassword === 'admin123';
      },
      populate: () => doc,
      select: () => doc,
      toObject: () => ({ ...doc }),
      toJSON: () => ({ ...doc })
    };
    return doc;
  }

  findOne(filter = {}) {
    const result = this.data.find(record => this._matches(record, filter));
    const doc = this._toDoc(result);

    const chain = {
      select: () => chain,
      populate: () => chain,
      exec: async () => doc,
      then: (onFullfilled) => Promise.resolve(doc).then(onFullfilled)
    };
    return chain;
  }

  findById(id) {
    return this.findOne({ _id: id });
  }

  async countDocuments(filter = {}) {
    return this.data.filter(record => this._matches(record, filter)).length;
  }

  async insertMany(records) {
    const newRecords = records.map(r => ({ ...r, _id: r._id || `id_${Date.now()}_${Math.random()}` }));
    this.data.push(...newRecords);
    return newRecords;
  }

  async deleteMany(filter = {}) {
    const initialCount = this.data.length;
    this.data = this.data.filter(record => !this._matches(record, filter));
    return { deletedCount: initialCount - this.data.length };
  }

  async findOneAndDelete(filter = {}) {
    const record = await this.findOne(filter);
    if (record) {
      this.data = this.data.filter(r => r._id !== record._id);
    }
    return record;
  }

  async aggregate(pipeline = []) {
    let currentData = [...this.data];

    for (const stage of pipeline) {
      if (stage.$match) {
        currentData = currentData.filter(record => this._matches(record, stage.$match));
      } else if (stage.$group) {
        // We handle simple $group only for dashboard stats
        const grouped = { _id: null, total: 0 }; // Default structure for simpler mock
        
        // Custom logic for Installment.aggregate used in dashboard (financial stats)
        if (this.modelName === 'Installment') {
            const stats = { _id: null, totalRecovered: 0, totalPending: 0, totalOverdue: 0 };
            const today = new Date();
            const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
            const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

            currentData.forEach(inst => {
                if (inst.status === 'pago' && inst.paymentDate >= startOfMonth && inst.paymentDate <= endOfMonth) {
                    stats.totalRecovered += (inst.paidAmount || 0);
                } else if (inst.status === 'pendente') {
                    stats.totalPending += (inst.amount || 0);
                } else if (inst.status === 'atrasado') {
                    stats.totalOverdue += (inst.amount || 0);
                }
            });
            return [stats];
        }

        // Catch-all for simple count-by-field aggregations (leads by status, source)
        const counts = {};
        const field = typeof stage.$group._id === 'string' && stage.$group._id.startsWith('$') 
            ? stage.$group._id.substring(1) 
            : '_id';

        currentData.forEach(item => {
            const key = item[field] || 'unknown';
            counts[key] = (counts[key] || 0) + 1;
        });

        return Object.keys(counts).map(key => ({ _id: key, count: counts[key] }));
      } else if (stage.$sort) {
        // Simple sort mock
      }
    }
    return currentData;
  }

  // To support "new Model(data)"
  static createConstructor(modelName) {
    const manager = new MockModel(modelName);
    function MockInstance(data) {
      Object.assign(this, data);
      this._id = this._id || `id_${Date.now()}`;
      this.save = async () => {
        manager.data.push({ ...this });
        return this;
      };
    }
    // Attach manager methods to the constructor (static methods)
    MockInstance.find = (f) => manager.find(f);
    MockInstance.findOne = (f) => manager.findOne(f);
    MockInstance.findById = (i) => manager.findById(i);
    MockInstance.countDocuments = (f) => manager.countDocuments(f);
    MockInstance.insertMany = (r) => manager.insertMany(r);
    MockInstance.deleteMany = (f) => manager.deleteMany(f);
    MockInstance.findOneAndDelete = (f) => manager.findOneAndDelete(f);
    MockInstance.aggregate = (p) => manager.aggregate(p);
    MockInstance.schema = { path: () => ({ enumValues: [] }) }; // Mock schema stats
    
    return MockInstance;
  }
}

module.exports = MockModel;
