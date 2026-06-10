// Chart tool — renders via QuickChart.io (Chart.js config → PNG).
// v1 trade-off: external API avoids native canvas builds on Windows.
// Data sent to quickchart.io — swap to local rendering when governance lands.

import axios from 'axios'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { Tool, ToolResult } from '../core/types.js'

const SCRATCH = path.resolve('scratch')

export const chartGenerateTool: Tool = {
  name: 'chart_generate',
  description:
    'Generate a chart PNG from data. Input: a Chart.js configuration object (type: bar/line/pie/scatter, data.labels, data.datasets). Returns the PNG file path, ready to attach to an email draft.',
  inputSchema: {
    type: 'object',
    properties: {
      chartConfig: {
        type: 'object',
        description:
          'Chart.js config, e.g. {"type":"bar","data":{"labels":["Jan","Feb"],"datasets":[{"label":"Revenue","data":[100,200]}]}}',
      },
      title: { type: 'string', description: 'Chart title (also used in filename)' },
    },
    required: ['chartConfig'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const res = await axios.post(
        'https://quickchart.io/chart',
        {
          chart: input.chartConfig,
          format: 'png',
          width: 800,
          height: 450,
          backgroundColor: 'white',
        },
        { responseType: 'arraybuffer', timeout: 20000 }
      )

      const dir = path.join(SCRATCH, 'outbound')
      fs.mkdirSync(dir, { recursive: true })
      const name = String(input.title ?? 'chart').replace(/[^\w\-]/g, '_').slice(0, 40)
      const outPath = path.join(dir, `${name}-${uuid().slice(0, 8)}.png`)
      fs.writeFileSync(outPath, Buffer.from(res.data))

      return { success: true, output: { filePath: outPath } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
